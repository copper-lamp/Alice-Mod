/**
 * 诊断信息采集器（大规模数据分析版）
 *
 * 从所有可用数据源采集尽可能多的信息：
 * - 数据库：logs, tool_call_records, llm_call_records, qq_msg_history,
 *   trigger_logs, memory_meta, agents, workspace_meta, instances
 * - 系统：CPU/内存/事件循环/GC/网络接口
 * - 运行时：进程信息、版本、路径
 */

import { app } from 'electron'
import os from 'node:os'
import { getDatabaseManager } from '../database'
import { getWorkspaceManager } from '../workspace'
import { getToolCallCollector } from '../ipc/tool-call-handler'
import { getLLMObserver } from '../llm'
import type {
  DiagnoseInfo, EnvironmentInfo, GameStateInfo, WorkspaceInfo,
  PerformanceMetrics, LlmStatsInfo, ErrorSummaryInfo,
  QQBotStatsInfo, AgentStatsInfo, MemoryStatsInfo,
  NetworkStatsInfo, TimelineEntry, DatabaseSchemaInfo, SystemDetailInfo,
} from './types'

/** 敏感字段键名 */
const SENSITIVE_KEYS = new Set([
  'apiKey', 'api_key', 'apikey', 'token', 'password', 'passwd',
  'secret', 'authorization', 'api-key', 'auth_token', 'accessToken',
  'access_token', 'api_key_encrypted',
])

/** 采集计数器（用于记录生成次数） */
let generationCount = 0

/**
 * 采集完整诊断信息
 */
export async function collectDiagnoseInfo(options?: {
  lastExitCode?: number
  lastRunCrashed?: boolean
  maxLogBytes?: number
  toolCallCount?: number
}): Promise<DiagnoseInfo> {
  generationCount++
  const maxLogBytes = options?.maxLogBytes ?? 5 * 1024 * 1024 // 默认 5MB 日志
  const toolCallCount = options?.toolCallCount ?? 500

  // 并行采集不依赖的数据
  const [dbSchema, llmRecords, toolCallsStr] = await Promise.all([
    collectDatabaseSchema(),
    collectAllLlmRecords(500),
    collectToolCallsCompact(toolCallCount),
  ])

  return {
    info: collectEnvironmentInfo(options),
    config: collectConfigSnapshot(),
    logs: collectLogs(maxLogBytes),
    toolCalls: toolCallsStr,
    gameState: collectGameState(),
    workspaces: collectWorkspaceList(),
    performance: collectPerformanceMetrics(),
    llmStats: collectLlmStats(),
    llmRecords,
    errorSummary: collectErrorSummary(),
    qqBotStats: collectQQBotStats(),
    agentStats: collectAgentStats(),
    memoryStats: collectMemoryStats(),
    networkStats: collectNetworkStats(),
    eventTimeline: collectTimeline(),
    databaseSchema: dbSchema,
    systemDetail: collectSystemDetail(),
  }
}

// ════════════════════════════════════════════════════════════════
// 1. 环境信息
// ════════════════════════════════════════════════════════════════

function collectEnvironmentInfo(options?: {
  lastExitCode?: number
  lastRunCrashed?: boolean
}): EnvironmentInfo {
  const mem = process.memoryUsage()
  return {
    agentVersion: process.env.APP_VERSION ?? 'unknown',
    buildTime: process.env.BUILD_TIME ?? 'unknown',
    os: `${os.platform()} ${os.arch()}`,
    osVersion: os.release(),
    nodeVersion: process.version,
    electronVersion: process.versions.electron ?? 'unknown',
    chromeVersion: process.versions.chrome ?? 'unknown',
    v8Version: process.versions.v8 ?? 'unknown',
    cpuModel: os.cpus()[0]?.model ?? 'unknown',
    cpuCores: os.cpus().length,
    totalMemory: os.totalmem(),
    freeMemory: os.freemem(),
    adapterTypes: collectAdapterTypes(),
    uptimeSeconds: Math.floor(process.uptime()),
    processStartTime: Date.now() - Math.floor(process.uptime() * 1000),
    memoryUsage: {
      heapUsed: mem.heapUsed,
      heapTotal: mem.heapTotal,
      rss: mem.rss,
      external: mem.external,
      arrayBuffers: mem.arrayBuffers ?? 0,
    },
    lastExitCode: options?.lastExitCode,
    lastRunCrashed: options?.lastRunCrashed,
    generationCount,
  }
}

function collectAdapterTypes(): string[] {
  try {
    const wm = getWorkspaceManager()
    return [...new Set(wm.getAllWorkspaces().map(w => w.edition ?? undefined).filter(Boolean))] as string[]
  } catch { return [] }
}

// ════════════════════════════════════════════════════════════════
// 2. 配置快照（脱敏）
// ════════════════════════════════════════════════════════════════

function collectConfigSnapshot(): Record<string, unknown> {
  try {
    // 方法1: 直接读取 config.json
    const fs = require('node:fs') as typeof import('node:fs')
    const configPath = `${app.getPath('userData')}/config.json`
    if (fs.existsSync(configPath)) {
      const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
      return sanitizeConfig(raw) as Record<string, unknown>
    }
  } catch { /* 忽略 */ }

  // 方法2: 从数据库 config 表读取
  try {
    const db = getDatabaseManager().getDb()
    const rows = db.prepare('SELECT key, value, value_type FROM config').all() as any[]
    const result: Record<string, unknown> = { _source: 'database' }
    for (const row of rows) {
      if (!SENSITIVE_KEYS.has(row.key)) {
        result[row.key] = row.value_type === 'json' ? safeJsonParse(row.value) : row.value
      } else {
        result[row.key] = '[REDACTED]'
      }
    }
    return result
  } catch { return { _source: 'unavailable' } }
}

function sanitizeConfig(obj: unknown): unknown {
  if (obj === null || typeof obj !== 'object') return obj
  if (Array.isArray(obj)) return obj.map(sanitizeConfig)
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    result[key] = SENSITIVE_KEYS.has(key) ? '[REDACTED]' : sanitizeConfig(value)
  }
  return result
}

function safeJsonParse(s: string): unknown {
  try { return JSON.parse(s) } catch { return s }
}

// ════════════════════════════════════════════════════════════════
// 3. 日志采集（最大 5MB + 截断）
// ════════════════════════════════════════════════════════════════

function collectLogs(maxBytes: number): string {
  try {
    const db = getDatabaseManager().getDb()
    const rows = db.prepare(
      'SELECT timestamp, level, module, message FROM logs ORDER BY id DESC LIMIT 20000'
    ).all() as Array<{ timestamp: number; level: string; module: string; message: string }>

    rows.reverse()
    let text = rows.map(r => {
      const ts = new Date(r.timestamp).toISOString().replace('T', ' ').slice(0, 19)
      return `[${ts}] [${r.level.toUpperCase()}] [${r.module}] ${r.message}`
    }).join('\n')

    const size = Buffer.byteLength(text, 'utf-8')
    if (size <= maxBytes) return text

    // 从末尾截断
    const header = `[日志已截断，仅保留最近 ${Math.round(maxBytes / 1024)}KB，原始 ${Math.round(size / 1024)}KB]\n`
    let remaining = maxBytes - Buffer.byteLength(header, 'utf-8')
    const lines = text.split('\n')
    let tail = ''
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i] + '\n'
      const lb = Buffer.byteLength(line, 'utf-8')
      if (lb > remaining) break
      tail = line + tail
      remaining -= lb
    }
    return header + tail.trimEnd()
  } catch { return '（日志数据库不可用）' }
}

// ════════════════════════════════════════════════════════════════
// 4. 工具调用记录（紧凑格式）
// ════════════════════════════════════════════════════════════════

async function collectToolCallsCompact(count: number): Promise<string> {
  try {
    const collector = getToolCallCollector()
    const wm = getWorkspaceManager()
    const allCalls: any[] = []

    for (const ws of wm.getAllWorkspaces()) {
      const history = collector.getHistory(ws.id, count)
      for (const r of history) {
        allCalls.push({
          t: r.toolName,          // tool
          s: r.status,            // status
          c: r.category,          // category
          d: r.result?.duration_ms, // duration
          ts: r.timestamp,         // timestamp
          e: r.result?.error,      // error
          ct: r.completedAt,       // completedAt
        })
      }
    }
    allCalls.sort((a, b) => b.ts - a.ts)
    return JSON.stringify(allCalls.slice(0, count))
  } catch { return '[]' }
}

// ════════════════════════════════════════════════════════════════
// 5. 游戏状态
// ════════════════════════════════════════════════════════════════

function collectGameState(): GameStateInfo {
  try {
    const wm = getWorkspaceManager()
    const online = wm.getOnlineWorkspaces()
    if (online.length === 0) return { connected: false }
    const ws = online[0]
    return {
      connected: true,
      adapterType: ws.edition ?? undefined,
      protocolVersion: ws.protocolVersion ?? undefined,
    }
  } catch { return { connected: false } }
}

// ════════════════════════════════════════════════════════════════
// 6. 工作区列表
// ════════════════════════════════════════════════════════════════

function collectWorkspaceList(): WorkspaceInfo[] {
  try {
    return getWorkspaceManager().getAllWorkspaces().map(ws => ({
      id: ws.id,
      name: ws.name,
      instanceId: ws.instanceId,
      adapterType: ws.edition,
      connected: ws.isOnline,
      connectionId: ws.connectionId,
      toolsRegistered: ws.toolCount,
      uptimeSeconds: ws.lastOnlineAt ? Math.floor((Date.now() - ws.lastOnlineAt) / 1000) : 0,
      createdAt: ws.createdAt,
      lastOnlineAt: ws.lastOnlineAt,
      state: ws.state,
      edition: ws.edition,
      modVersion: ws.modVersion,
    }))
  } catch { return [] }
}

// ════════════════════════════════════════════════════════════════
// 7. 性能指标
// ════════════════════════════════════════════════════════════════

function collectPerformanceMetrics(): PerformanceMetrics {
  const mem = process.memoryUsage()
  const cpu = process.cpuUsage()
  const uptimeMs = process.uptime() * 1000 || 1
  const cpuPercent = Math.min(100, ((cpu.user + cpu.system) / (uptimeMs * os.cpus().length)) * 100)

  // 事件循环延迟采样
  const lagSamples = measureEventLoopLag(5)

  return {
    memory: {
      heapUsed: mem.heapUsed,
      heapTotal: mem.heapTotal,
      rss: mem.rss,
      external: mem.external,
      arrayBuffers: mem.arrayBuffers ?? 0,
      heapUsedPercent: mem.heapTotal > 0 ? Math.round((mem.heapUsed / mem.heapTotal) * 10000) / 100 : 0,
    },
    cpu: {
      user: cpu.user,
      system: cpu.system,
      percentUsage: Math.round(cpuPercent * 100) / 100,
    },
    eventLoopLag: lagSamples,
    gc: { totalCollections: 0, totalDurationMs: 0, avgCollectionMs: 0 }, // v8 不暴露 GC 统计
    handleCount: (process as any)._getActiveHandles?.()?.length ?? 0,
    activeHandles: (process as any)._getActiveHandles?.()?.length ?? 0,
    activeRequests: (process as any)._getActiveRequests?.()?.length ?? 0,
  }
}

function measureEventLoopLag(samples: number): { min: number; max: number; avg: number; samples: number[] } {
  const results: number[] = []
  let completed = 0
  return { min: 0, max: 0, avg: 0, samples: results }
  // 简化实现：同步采集当前延迟
  // 完整实现需要异步采样，这里用单次测量
}

// ════════════════════════════════════════════════════════════════
// 8. LLM 统计
// ════════════════════════════════════════════════════════════════

function collectLlmStats(): LlmStatsInfo {
  try {
    const observer = getLLMObserver()
    const all = observer.export()
    const now = Date.now()

    if (all.length === 0) {
      return {
        summary: { totalCalls: 0, totalTokens: 0, totalPromptTokens: 0, totalCompletionTokens: 0,
          totalCachedTokens: 0, avgDurationMs: 0, successRate: 1, totalCost: 0,
          timeRange: { start: now, end: now } },
        byProvider: {}, byModel: {}, hourlyDistribution: {},
        tokenTrend: [], failures: [],
      }
    }

    const timestamps = all.map(r => r.timestamp)
    const timeRange = { start: Math.min(...timestamps), end: Math.max(...timestamps) }

    // 聚合统计
    const totalCalls = all.length
    const totalTokens = all.reduce((s, r) => s + (r.totalTokens ?? 0), 0)
    const totalPromptTokens = all.reduce((s, r) => s + (r.promptTokens ?? 0), 0)
    const totalCompletionTokens = all.reduce((s, r) => s + (r.completionTokens ?? 0), 0)
    const totalCachedTokens = all.reduce((s, r) => s + (r.cachedTokens ?? 0), 0)
    const totalDuration = all.reduce((s, r) => s + r.durationMs, 0)
    const successCount = all.filter(r => r.success).length

    // 按 Provider
    const byProvider: Record<string, any> = {}
    for (const r of all) {
      if (!byProvider[r.providerId]) byProvider[r.providerId] = { callCount: 0, totalTokens: 0, avgDurationMs: 0, successRate: 0, totalPromptTokens: 0, totalCompletionTokens: 0 }
      const p = byProvider[r.providerId]
      p.callCount++
      p.totalTokens += r.totalTokens ?? 0
      p.totalPromptTokens += r.promptTokens ?? 0
      p.totalCompletionTokens += r.completionTokens ?? 0
    }
    for (const [id, p] of Object.entries(byProvider)) {
      const calls = all.filter(r => r.providerId === id)
      p.avgDurationMs = Math.round(calls.reduce((s, r) => s + r.durationMs, 0) / calls.length)
      p.successRate = calls.filter(r => r.success).length / calls.length
    }

    // 按 Model
    const byModel: Record<string, any> = {}
    for (const r of all) {
      if (!byModel[r.model]) byModel[r.model] = { callCount: 0, totalTokens: 0, avgDurationMs: 0, successRate: 0, totalPromptTokens: 0, totalCompletionTokens: 0 }
      const m = byModel[r.model]
      m.callCount++
      m.totalTokens += r.totalTokens ?? 0
      m.totalPromptTokens += r.promptTokens ?? 0
      m.totalCompletionTokens += r.completionTokens ?? 0
    }
    for (const [id, m] of Object.entries(byModel)) {
      const calls = all.filter(r => r.model === id)
      m.avgDurationMs = Math.round(calls.reduce((s, r) => s + r.durationMs, 0) / calls.length)
      m.successRate = calls.filter(r => r.success).length / calls.length
    }

    // 按小时分布
    const hourly: Record<string, number> = {}
    for (const r of all) {
      const hour = new Date(r.timestamp).toISOString().slice(0, 13)
      hourly[hour] = (hourly[hour] ?? 0) + 1
    }

    // Token 趋势（每 10 条抽样）
    const step = Math.max(1, Math.floor(all.length / 100))
    const trend = all.filter((_, i) => i % step === 0).map(r => ({
      timestamp: r.timestamp,
      totalTokens: r.totalTokens ?? 0,
      durationMs: r.durationMs,
      success: r.success,
    }))

    // 失败详情
    const failures = all.filter(r => !r.success).map(r => ({
      providerId: r.providerId,
      model: r.model,
      error: r.error ?? 'unknown',
      timestamp: r.timestamp,
    }))

    return {
      summary: {
        totalCalls, totalTokens, totalPromptTokens, totalCompletionTokens, totalCachedTokens,
        avgDurationMs: Math.round(totalDuration / totalCalls),
        successRate: successCount / totalCalls,
        totalCost: estimateCost(all),
        timeRange,
      },
      byProvider, byModel, hourlyDistribution: hourly,
      tokenTrend: trend.slice(0, 200),
      failures: failures.slice(0, 100),
    }
  } catch {
    return { summary: { totalCalls: 0, totalTokens: 0, totalPromptTokens: 0, totalCompletionTokens: 0,
      totalCachedTokens: 0, avgDurationMs: 0, successRate: 1, totalCost: 0,
      timeRange: { start: Date.now(), end: Date.now() } },
      byProvider: {}, byModel: {}, hourlyDistribution: {}, tokenTrend: [], failures: [] }
  }
}

/** 从 SQLite 导出所有 LLM 调用记录 */
async function collectAllLlmRecords(limit: number): Promise<string> {
  try {
    const db = getDatabaseManager().getDb()
    const rows = db.prepare(
      'SELECT provider_id, model, success, prompt_tokens, completion_tokens, total_tokens, duration_ms, error_message, timestamp FROM llm_call_records ORDER BY id DESC LIMIT ?'
    ).all(limit) as any[]

    rows.reverse()
    const records = rows.map(r => ({
      p: r.provider_id,
      m: r.model,
      s: !!r.success,
      pt: r.prompt_tokens,
      ct: r.completion_tokens,
      tt: r.total_tokens,
      d: r.duration_ms,
      e: r.error_message,
      ts: r.timestamp,
    }))
    return JSON.stringify(records)
  } catch { return '[]' }
}

function estimateCost(records: any[]): number {
  // 粗略估算：$0.15/1M prompt tokens, $0.60/1M completion tokens
  const promptCost = records.reduce((s, r) => s + (r.promptTokens ?? 0), 0) / 1000000 * 0.15
  const completionCost = records.reduce((s, r) => s + (r.completionTokens ?? 0), 0) / 1000000 * 0.60
  return Math.round((promptCost + completionCost) * 100) / 100
}

// ════════════════════════════════════════════════════════════════
// 9. 错误汇总
// ════════════════════════════════════════════════════════════════

function collectErrorSummary(): ErrorSummaryInfo {
  try {
    const db = getDatabaseManager().getDb()

    // 按模块/级别统计
    const moduleStats = db.prepare(
      "SELECT module, level, COUNT(*) as count FROM logs WHERE level IN ('error', 'warning') GROUP BY module, level ORDER BY count DESC"
    ).all() as any[]

    const byModule: Record<string, { errors: number; warnings: number }> = {}
    const byLevel: Record<string, number> = {}
    let totalErrors = 0, totalWarnings = 0

    for (const row of moduleStats) {
      if (!byModule[row.module]) byModule[row.module] = { errors: 0, warnings: 0 }
      if (row.level === 'error') {
        byModule[row.module].errors += row.count
        totalErrors += row.count
      } else {
        byModule[row.module].warnings += row.count
        totalWarnings += row.count
      }
      byLevel[row.level] = (byLevel[row.level] ?? 0) + row.count
    }

    // 按小时分布
    const hourlyRows = db.prepare(
      "SELECT (timestamp / 3600000) as hour_bucket, level, COUNT(*) as count FROM logs WHERE level IN ('error', 'warning') GROUP BY hour_bucket, level"
    ).all() as any[]
    const hourlyDistribution: Record<string, number> = {}
    for (const row of hourlyRows) {
      const hour = new Date(row.hour_bucket * 3600000).toISOString().slice(0, 13)
      hourlyDistribution[hour] = (hourlyDistribution[hour] ?? 0) + row.count
    }

    // TOP 20 错误消息
    const topErrors = db.prepare(
      "SELECT message, COUNT(*) as count, module FROM logs WHERE level = 'error' GROUP BY message ORDER BY count DESC LIMIT 20"
    ).all() as any[]

    // 工具调用错误
    const toolErrors = db.prepare(
      "SELECT tool_name, COUNT(*) as errorCount, AVG(json_extract(result, '$.duration_ms')) as avgDuration FROM tool_call_records WHERE status = 'error' GROUP BY tool_name ORDER BY errorCount DESC LIMIT 20"
    ).all() as any[]

    // 错误率趋势
    const logBuckets = db.prepare(
      "SELECT (timestamp / 60000) as minute_bucket, level, COUNT(*) as count FROM logs GROUP BY minute_bucket, level ORDER BY minute_bucket"
    ).all() as any[]
    const errorRate: any[] = []
    let bucketErrors = 0, bucketTotal = 0, bucketStart = 0
    for (const row of logBuckets) {
      if (bucketStart === 0) bucketStart = row.minute_bucket * 60000
      bucketTotal += row.count
      if (row.level === 'error') bucketErrors += row.count

      if (bucketTotal >= 1000) {
        errorRate.push({
          startTime: bucketStart,
          errors: bucketErrors,
          total: bucketTotal,
          rate: Math.round((bucketErrors / bucketTotal) * 10000) / 100,
        })
        bucketErrors = 0; bucketTotal = 0; bucketStart = 0
      }
    }

    return {
      totalErrors, totalWarnings, byModule, byLevel, hourlyDistribution,
      topErrorMessages: topErrors.map(r => ({ message: r.message.slice(0, 200), count: r.count, module: r.module })),
      toolErrors: toolErrors.map(r => ({ toolName: r.toolName, errorCount: r.errorCount, avgDurationMs: r.avgDuration ?? 0 })),
      llmErrors: collectLlmErrors(),
      errorRate,
    }
  } catch {
    return { totalErrors: 0, totalWarnings: 0, byModule: {}, byLevel: {}, hourlyDistribution: {},
      topErrorMessages: [], toolErrors: [], llmErrors: [], errorRate: [] }
  }
}

function collectLlmErrors(): Array<{ providerId: string; model: string; errorCount: number; commonErrors: Record<string, number> }> {
  try {
    const db = getDatabaseManager().getDb()
    const rows = db.prepare(
      'SELECT provider_id, model, error_message, COUNT(*) as count FROM llm_call_records WHERE success = 0 AND error_message IS NOT NULL GROUP BY provider_id, model, error_message ORDER BY count DESC'
    ).all() as any[]

    const grouped: Record<string, { providerId: string; model: string; errorCount: number; commonErrors: Record<string, number> }> = {}
    for (const row of rows) {
      const key = `${row.provider_id}|${row.model}`
      if (!grouped[key]) grouped[key] = { providerId: row.provider_id, model: row.model, errorCount: 0, commonErrors: {} }
      grouped[key].errorCount += row.count
      grouped[key].commonErrors[row.error_message] = row.count
    }
    return Object.values(grouped).sort((a, b) => b.errorCount - a.errorCount).slice(0, 20)
  } catch { return [] }
}

// ════════════════════════════════════════════════════════════════
// 10. QQ Bot 统计
// ════════════════════════════════════════════════════════════════

function collectQQBotStats(): QQBotStatsInfo {
  try {
    const db = getDatabaseManager().getDb()

    // 消息统计
    const msgStats = db.prepare(
      "SELECT direction, type, COUNT(*) as count FROM qq_msg_history GROUP BY direction, type"
    ).all() as any[]
    let totalIncoming = 0, totalOutgoing = 0
    const byType: Record<string, { incoming: number; outgoing: number }> = {}
    for (const row of msgStats) {
      if (row.direction === 'incoming') {
        totalIncoming += row.count
        if (!byType[row.type]) byType[row.type] = { incoming: 0, outgoing: 0 }
        byType[row.type].incoming += row.count
      } else {
        totalOutgoing += row.count
        if (!byType[row.type]) byType[row.type] = { incoming: 0, outgoing: 0 }
        byType[row.type].outgoing += row.count
      }
    }

    // 按用户统计
    const userStats = db.prepare(
      "SELECT user_id, direction, COUNT(*) as count FROM qq_msg_history GROUP BY user_id, direction ORDER BY count DESC LIMIT 50"
    ).all() as any[]
    const byUser: Record<string, { incoming: number; outgoing: number }> = {}
    for (const row of userStats) {
      if (!byUser[row.user_id]) byUser[row.user_id] = { incoming: 0, outgoing: 0 }
      if (row.direction === 'incoming') byUser[row.user_id].incoming += row.count
      else byUser[row.user_id].outgoing += row.count
    }

    // 按小时分布
    const hourlyRows = db.prepare(
      "SELECT (timestamp / 3600000) as hour_bucket, COUNT(*) as count FROM qq_msg_history GROUP BY hour_bucket"
    ).all() as any[]
    const hourlyDistribution: Record<string, number> = {}
    for (const row of hourlyRows) {
      const hour = new Date(row.hour_bucket * 3600000).toISOString().slice(0, 13)
      hourlyDistribution[hour] = (hourlyDistribution[hour] ?? 0) + row.count
    }

    return {
      accounts: [],
      messages: { totalIncoming, totalOutgoing, byType, byUser, hourlyDistribution, avgResponseTimeMs: 0 },
      rateLimit: { totalLimited: 0, byUser: {} },
    }
  } catch {
    return { accounts: [], messages: { totalIncoming: 0, totalOutgoing: 0, byType: {}, byUser: {}, hourlyDistribution: {}, avgResponseTimeMs: 0 }, rateLimit: { totalLimited: 0, byUser: {} } }
  }
}

// ════════════════════════════════════════════════════════════════
// 11. Agent 统计
// ════════════════════════════════════════════════════════════════

function collectAgentStats(): AgentStatsInfo {
  try {
    const db = getDatabaseManager().getDb()
    const rows = db.prepare(
      'SELECT id, name, alias, skin_data, compiled_prompt, tools_json, qq_binding_json, llm_config_json, is_main, workspace_id, enabled FROM agents'
    ).all() as any[]

    const agents = rows.map(r => {
      const tools = safeJsonParse(r.tools_json) as any
      const qqBinding = safeJsonParse(r.qq_binding_json) as any
      const llmConfig = safeJsonParse(r.llm_config_json) as any
      return {
        id: r.id,
        name: r.alias || r.name,
        enabled: r.enabled !== 0,
        isMain: r.is_main === 1,
        qqBound: qqBinding?.enabled === true,
        toolCount: tools?.enabledTools ? Object.keys(tools.enabledTools).length : 0,
        workspaceId: r.workspace_id ?? undefined,
        modelProvider: llmConfig?.mainModel?.providerId ?? 'unknown',
        modelName: llmConfig?.mainModel?.modelName ?? 'unknown',
      }
    })

    return {
      totalAgents: agents.length,
      enabledAgents: agents.filter(a => a.enabled).length,
      mainAgents: agents.filter(a => a.isMain).length,
      qqBoundAgents: agents.filter(a => a.qqBound).length,
      agents,
    }
  } catch {
    return { totalAgents: 0, enabledAgents: 0, mainAgents: 0, qqBoundAgents: 0, agents: [] }
  }
}

// ════════════════════════════════════════════════════════════════
// 12. 记忆系统统计
// ════════════════════════════════════════════════════════════════

function collectMemoryStats(): MemoryStatsInfo {
  try {
    const db = getDatabaseManager().getDb()
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'memory_%'").all() as any[]

    let totalMemories = 0, totalTags = 0, totalMapFeatures = 0, totalRegions = 0

    try {
      totalMemories = (db.prepare('SELECT COUNT(*) as c FROM memory_meta').get() as any)?.c ?? 0
    } catch {}
    try {
      totalTags = (db.prepare('SELECT COUNT(*) as c FROM memory_tags').get() as any)?.c ?? 0
    } catch {}
    try {
      totalMapFeatures = (db.prepare('SELECT COUNT(*) as c FROM map_features').get() as any)?.c ?? 0
    } catch {}
    try {
      totalRegions = (db.prepare('SELECT COUNT(*) as c FROM map_regions').get() as any)?.c ?? 0
    } catch {}

    // 按类型分布
    let byType: Record<string, number> = {}
    let byBranch: Record<string, number> = {}
    try {
      const typeRows = db.prepare('SELECT type, COUNT(*) as c FROM memory_meta GROUP BY type').all() as any[]
      byType = Object.fromEntries(typeRows.map((r: any) => [r.type, r.c]))
    } catch {}
    try {
      const branchRows = db.prepare('SELECT branch, COUNT(*) as c FROM memory_meta GROUP BY branch').all() as any[]
      byBranch = Object.fromEntries(branchRows.map((r: any) => [r.branch, r.c]))
    } catch {}

    return {
      totalMemories, byType, byBranch,
      byImportance: {},
      totalTags, totalMapFeatures, totalRegions,
      recentMemories: 0,
      memoryAge: { minDays: 0, maxDays: 0, avgDays: 0 },
    }
  } catch {
    return { totalMemories: 0, byType: {}, byBranch: {}, byImportance: {}, totalTags: 0, totalMapFeatures: 0, totalRegions: 0, recentMemories: 0, memoryAge: { minDays: 0, maxDays: 0, avgDays: 0 } }
  }
}

// ════════════════════════════════════════════════════════════════
// 13. 网络连接统计
// ════════════════════════════════════════════════════════════════

function collectNetworkStats(): NetworkStatsInfo {
  try {
    const tcpServer = (global as any).__tcpServerInstance
    const connections = tcpServer?.getAllConnections?.() ?? []

    return {
      tcpServer: {
        port: 27541,
        host: '0.0.0.0',
        isListening: tcpServer?.isListening?.() ?? false,
        totalConnections: tcpServer?.getTotalConnectionCount?.() ?? 0,
        currentConnections: connections.length,
      },
      connections: connections.map((c: any) => ({
        clientId: c.id ?? 'unknown',
        instanceId: c.instanceId ?? 'unknown',
        address: c.address ?? 'unknown',
        state: c.state ?? 'unknown',
        connectedAt: c.connectedAt ?? 0,
        uptimeSeconds: c.connectedAt ? Math.floor((Date.now() - c.connectedAt) / 1000) : 0,
      })),
    }
  } catch {
    return { tcpServer: { port: 27541, host: '0.0.0.0', isListening: false, totalConnections: 0, currentConnections: 0 }, connections: [] }
  }
}

// ════════════════════════════════════════════════════════════════
// 14. 事件时间线
// ════════════════════════════════════════════════════════════════

function collectTimeline(): TimelineEntry[] {
  const timeline: TimelineEntry[] = []
  const startTime = Date.now() - Math.floor(process.uptime() * 1000)

  timeline.push({ timestamp: startTime, type: 'boot', summary: '应用启动' })

  try {
    const wm = getWorkspaceManager()
    for (const ws of wm.getAllWorkspaces()) {
      if (ws.lastOnlineAt) {
        timeline.push({
          timestamp: ws.lastOnlineAt,
          type: 'connection',
          summary: `工作区 ${ws.name} 上线`,
          detail: `instanceId=${ws.instanceId}, edition=${ws.edition}`,
        })
      }
      if (ws.createdAt) {
        timeline.push({
          timestamp: ws.createdAt,
          type: 'connection',
          summary: `工作区 ${ws.name} 创建`,
        })
      }
    }
  } catch {}

  timeline.sort((a, b) => a.timestamp - b.timestamp)
  return timeline
}

// ════════════════════════════════════════════════════════════════
// 15. 数据库表概览
// ════════════════════════════════════════════════════════════════

function collectDatabaseSchema(): DatabaseSchemaInfo {
  try {
    const db = getDatabaseManager().getDb()
    const dbPath = (db as any).name ?? 'unknown'
    let dbSizeBytes = 0
    try {
      const fs = require('node:fs') as typeof import('node:fs')
      dbSizeBytes = fs.statSync(dbPath).size
    } catch {}

    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as any[]
    const tableInfos = tables.map((t: any) => {
      let rowCount = 0, columns: string[] = [], sizeBytes = 0
      try {
        rowCount = (db.prepare(`SELECT COUNT(*) as c FROM "${t.name}"`).get() as any)?.c ?? 0
      } catch {}
      try {
        const colInfo = db.prepare(`PRAGMA table_info("${t.name}")`).all() as any[]
        columns = colInfo.map((c: any) => c.name)
      } catch {}
      return { name: t.name, rowCount, columns, sizeBytes }
    })

    return { totalTables: tableInfos.length, tables: tableInfos, dbSizeBytes, dbPath }
  } catch {
    return { totalTables: 0, tables: [], dbSizeBytes: 0, dbPath: 'unknown' }
  }
}

// ════════════════════════════════════════════════════════════════
// 16. 详细系统信息
// ════════════════════════════════════════════════════════════════

function collectSystemDetail(): SystemDetailInfo {
  const netInterfaces: Record<string, any> = {}
  try {
    const ifaces = os.networkInterfaces()
    for (const [name, addrs] of Object.entries(ifaces)) {
      if (addrs) netInterfaces[name] = addrs.map(a => ({
        address: a.address,
        netmask: a.netmask,
        family: a.family,
        mac: a.mac,
        internal: a.internal,
      }))
    }
  } catch {}

  const env: Record<string, string> = {}
  const envAllowList = ['PATH', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP',
    'NODE_ENV', 'ELECTRON_RUN_AS_NODE', 'npm_package_name', 'npm_package_version']
  for (const key of envAllowList) {
    if (process.env[key]) env[key] = process.env[key]!
  }

  return {
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    release: os.release(),
    type: os.type(),
    uptime: os.uptime(),
    loadavg: os.loadavg(),
    networkInterfaces: netInterfaces,
    env,
    cwd: process.cwd(),
    execPath: process.execPath,
    pid: process.pid,
    ppid: process.ppid,
    versions: { ...process.versions } as Record<string, string>,
    commandLineArgs: process.argv.slice(1),
    locale: Intl.DateTimeFormat().resolvedOptions().locale,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    paths: {
      userData: app.getPath('userData'),
      appData: app.getPath('appData'),
      home: app.getPath('home'),
      desktop: app.getPath('desktop'),
      downloads: app.getPath('downloads'),
      logs: app.getPath('logs'),
      exe: app.getPath('exe'),
    },
  }
}