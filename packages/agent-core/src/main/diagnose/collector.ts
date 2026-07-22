/**
 * 诊断信息采集器
 *
 * 从各模块采集诊断信息，自动脱敏，日志截断。
 */

import { app } from 'electron'
import { getDatabaseManager } from '../database'
import { getWorkspaceManager } from '../workspace'
import { getToolCallCollector } from '../ipc/tool-call-handler'
import type { EnvironmentInfo, GameStateInfo, WorkspaceInfo, DiagnoseInfo } from './types'

/** 敏感字段键名（递归跳过） */
const SENSITIVE_KEYS = new Set([
  'apiKey', 'api_key', 'apikey',
  'token', 'password', 'passwd', 'secret', 'authorization',
  'api-key', 'auth_token', 'accessToken', 'access_token',
])

/**
 * 采集完整诊断信息
 */
export async function collectDiagnoseInfo(options?: {
  lastExitCode?: number
  lastRunCrashed?: boolean
  maxLogBytes?: number
  toolCallCount?: number
}): Promise<DiagnoseInfo> {
  const maxLogBytes = options?.maxLogBytes ?? 500 * 1024
  const toolCallCount = options?.toolCallCount ?? 50

  return {
    info: collectEnvironmentInfo(options),
    config: collectConfigSnapshot(),
    logs: collectLogs(maxLogBytes),
    toolCalls: collectToolCallsCompact(toolCallCount),
    gameState: collectGameState(),
    workspaces: collectWorkspaceList(),
  }
}

/**
 * 采集环境信息
 */
function collectEnvironmentInfo(options?: {
  lastExitCode?: number
  lastRunCrashed?: boolean
}): EnvironmentInfo {
  const info: EnvironmentInfo = {
    agentVersion: process.env.APP_VERSION ?? 'unknown',
    buildTime: process.env.BUILD_TIME ?? 'unknown',
    os: `${process.platform} ${process.arch}`,
    nodeVersion: process.version,
    electronVersion: process.versions.electron ?? 'unknown',
    adapterTypes: collectAdapterTypes(),
    uptimeSeconds: Math.floor(process.uptime()),
    memoryUsage: {
      heapUsed: process.memoryUsage().heapUsed,
      heapTotal: process.memoryUsage().heapTotal,
      rss: process.memoryUsage().rss,
    },
  }

  if (options?.lastExitCode !== undefined) {
    info.lastExitCode = options.lastExitCode
  }
  if (options?.lastRunCrashed !== undefined) {
    info.lastRunCrashed = options.lastRunCrashed
  }

  return info
}

/**
 * 采集已连接的 Adapter 类型
 */
function collectAdapterTypes(): string[] {
  try {
    const wm = getWorkspaceManager()
    const types = new Set<string>()
    for (const ws of wm.getAllWorkspaces()) {
      if (ws.edition) types.add(ws.edition)
    }
    return Array.from(types)
  } catch {
    return []
  }
}

/**
 * 采集配置快照（脱敏）
 *
 * 从 SQLite 数据库读取全局配置，跳过敏感字段。
 * 当前通过查询 instances 表获取基础配置信息。
 */
function collectConfigSnapshot(): Record<string, unknown> {
  const snapshot: Record<string, unknown> = {}

  // 递归脱敏配置对象，返回 Record<string, unknown>
  function sanitizeConfig(obj: unknown): unknown {
    if (obj === null || typeof obj !== 'object') return obj
    if (Array.isArray(obj)) return obj.map(sanitizeConfig)

    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.has(key)) {
        result[key] = '[REDACTED]'
      } else {
        result[key] = sanitizeConfig(value)
      }
    }
    return result
  }

  try {
    // 尝试读取主配置文件
    const userDataPath = app.getPath('userData')
    const configPath = `${userDataPath}/config.json`
    const fs = require('node:fs') as typeof import('node:fs')
    if (fs.existsSync(configPath)) {
      const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
      return sanitizeConfig(raw) as Record<string, unknown>
    }
  } catch {
    // 配置文件不存在或不可读，跳过
  }

  // 回退：从数据库读取可用信息
  try {
    const db = getDatabaseManager().getDb()
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table'"
    ).all() as { name: string }[]
    snapshot._availableTables = tables.map(t => t.name)
  } catch {
    snapshot._dbError = 'unavailable'
  }

  return snapshot
}

/**
 * 采集日志（从 SQLite 数据库，截断至 maxBytes）
 */
function collectLogs(maxBytes: number): string {
  try {
    const db = getDatabaseManager().getDb()
    const rows = db.prepare(
      'SELECT timestamp, level, module, message FROM logs ORDER BY id DESC LIMIT 5000'
    ).all() as Array<{ timestamp: number; level: string; module: string; message: string }>

    // 反转得到时间正序
    rows.reverse()

    let text = rows.map(r => {
      const ts = new Date(r.timestamp).toISOString().replace('T', ' ').slice(0, 19)
      return `[${ts}] [${r.level.toUpperCase()}] [${r.module}] ${r.message}`
    }).join('\n')

    if (Buffer.byteLength(text, 'utf-8') <= maxBytes) {
      return text
    }

    // 从末尾截断
    const header = `[日志已截断，仅保留最近 ${Math.round(maxBytes / 1024)}KB]\n`
    let remaining = maxBytes - Buffer.byteLength(header, 'utf-8')
    const lines = text.split('\n')
    let tail = ''

    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i] + '\n'
      const lineBytes = Buffer.byteLength(line, 'utf-8')
      if (lineBytes > remaining) break
      tail = line + tail
      remaining -= lineBytes
    }

    return header + tail.trimEnd()
  } catch {
    return '（日志数据库不可用）'
  }
}

/**
 * 采集工具调用记录（紧凑 JSON 格式）
 */
function collectToolCallsCompact(count: number): string {
  try {
    const collector = getToolCallCollector()
    // 从所有工作区获取最近的工具调用
    const wm = getWorkspaceManager()
    const allCalls: Array<{
      toolName: string
      status: string
      durationMs?: number
      timestamp: number
      error?: string
    }> = []

    for (const ws of wm.getAllWorkspaces()) {
      const history = collector.getHistory(ws.id, count)
      for (const record of history) {
        allCalls.push({
          toolName: record.toolName,
          status: record.status,
          durationMs: record.result?.duration_ms,
          timestamp: record.timestamp,
          error: record.result?.error,
        })
      }
    }

    // 按时间排序取最新
    allCalls.sort((a, b) => b.timestamp - a.timestamp)
    const top = allCalls.slice(0, count)

    // 紧凑格式：短字段名
    const compact = top.map(c => ({
      t: c.toolName,
      s: c.status,
      d: c.durationMs,
      ts: c.timestamp,
      e: c.error,
    }))

    return JSON.stringify(compact)
  } catch {
    return '[]'
  }
}

/**
 * 采集游戏状态
 */
function collectGameState(): GameStateInfo {
  try {
    const wm = getWorkspaceManager()
    const online = wm.getOnlineWorkspaces()

    if (online.length === 0) {
      return { connected: false }
    }

    const ws = online[0]
    // 通过 TCP 连接获取游戏状态
    // 当前无法直接从 Workspace 获取 health/hunger 等字段，
    // 这些数据需要通过 ToolCall 的上下文获取
    return {
      connected: true,
      adapterType: ws.edition ?? undefined,
      dimension: undefined,  // 需要从 AgentContext 获取
    }
  } catch {
    return { connected: false }
  }
}

/**
 * 采集工作区列表
 */
function collectWorkspaceList(): WorkspaceInfo[] {
  try {
    const wm = getWorkspaceManager()
    return wm.getAllWorkspaces().map(ws => ({
      id: ws.id,
      name: ws.name,
      adapterType: ws.edition,
      connected: ws.isOnline,
      toolsRegistered: ws.toolCount,
      uptimeSeconds: ws.lastOnlineAt
        ? Math.floor((Date.now() - ws.lastOnlineAt) / 1000)
        : 0,
    }))
  } catch {
    return []
  }
}