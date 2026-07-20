import { ipcMain } from 'electron'
import path from 'path'
import fs from 'node:fs'
import { app } from 'electron'
import type { ModelConfigItem, UsageStats, ContextTokenInfo } from '../../renderer/src/lib/types'
import { getDatabaseManager } from '../database'
import { getLLMObserver } from '../llm/observer/llm-observer'
import { getChatHistoryStore } from './chat-handler'

// ════════════════════════════════════════════════════════════════
// Provider 级别默认值（Layer 2 兜底）
// 注册表未覆盖时，按 Provider 返回合理默认值
// ════════════════════════════════════════════════════════════════
const PROVIDER_DEFAULTS: Record<string, { contextWindow: number; supportsFC: boolean }> = {
  openai:     { contextWindow: 128000, supportsFC: true },
  claude:     { contextWindow: 200000, supportsFC: true },
  gemini:     { contextWindow: 1048576, supportsFC: false },
  ollama:     { contextWindow: 4096,   supportsFC: false },
  deepseek:   { contextWindow: 65536,  supportsFC: true },
  qwen:       { contextWindow: 131072, supportsFC: true },
  moonshot:   { contextWindow: 131072, supportsFC: false },
  zhipu:      { contextWindow: 131072, supportsFC: true },
  ernie:      { contextWindow: 131072, supportsFC: true },
  doubao:     { contextWindow: 131072, supportsFC: true },
  yi:         { contextWindow: 32768,  supportsFC: true },
  baichuan:   { contextWindow: 32768,  supportsFC: true },
  minimax:    { contextWindow: 16384,  supportsFC: false },
  spark:      { contextWindow: 8192,   supportsFC: false },
  sensechat:  { contextWindow: 131072, supportsFC: false },
  stepfun:    { contextWindow: 8192,   supportsFC: false },
  huggingface: { contextWindow: 8192, supportsFC: false },
}

// ════════════════════════════════════════════════════════════════
// Provider 信息（名称 + 默认 Base URL）
// ════════════════════════════════════════════════════════════════
const PROVIDER_INFO: Record<string, { name: string; baseUrl: string }> = {
  openai: { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
  claude: { name: 'Claude', baseUrl: 'https://api.anthropic.com/v1' },
  gemini: { name: 'Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta' },
  ollama: { name: 'Ollama (本地)', baseUrl: 'http://127.0.0.1:11434' },
  deepseek: { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1' },
  qwen: { name: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  moonshot: { name: '月之暗面 (Kimi)', baseUrl: 'https://api.moonshot.cn/v1' },
  zhipu: { name: '智谱 (GLM)', baseUrl: 'https://open.bigmodel.cn/api/paas/v4' },
  ernie: { name: '百度文心 (ERNIE)', baseUrl: 'https://aip.baidubce.com/rpc/2.0/ai_custom' },
  doubao: { name: '字节豆包', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3' },
  yi: { name: '零一万物 (Yi)', baseUrl: 'https://api.lingyiwanwu.com/v1' },
  baichuan: { name: '百川 (Baichuan)', baseUrl: 'https://api.baichuan-ai.com/v1' },
  minimax: { name: 'MiniMax', baseUrl: 'https://api.minimax.chat/v1' },
  spark: { name: '讯飞星火', baseUrl: 'https://spark-api.xf-yun.com/v3.5/chat' },
  sensechat: { name: '商汤 (SenseChat)', baseUrl: 'https://api.sensetime.com/v1' },
  stepfun: { name: '阶跃星辰 (StepFun)', baseUrl: 'https://api.stepfun.com/v1' },
  huggingface: { name: 'HuggingFace', baseUrl: 'https://api-inference.huggingface.co/models' },
}

// ════════════════════════════════════════════════════════════════
// 注册表缓存（Layer 1 数据源）
// ════════════════════════════════════════════════════════════════
const REGISTRY_URL = 'https://models.dev/api.json'
const REFRESH_INTERVAL = 24 * 60 * 60 * 1000 // 每天一次

interface RegistryModelEntry {
  contextWindow: number
  supportsFunctionCalling: boolean
}

let registryCache: Map<string, RegistryModelEntry> | null = null
let registryLastUpdated = 0

/** 获取缓存文件路径 */
function getCacheFilePath(): string {
  const userDataPath = app.getPath('userData')
  return path.join(userDataPath, 'model-registry-cache.json')
}

/** 从本地加载缓存 */
function loadCacheSync(): void {
  try {
    const filePath = getCacheFilePath()
    if (!fs.existsSync(filePath)) return
    const raw = fs.readFileSync(filePath, 'utf-8')
    const data = JSON.parse(raw) as { models: Record<string, RegistryModelEntry>; lastUpdated: number }
    registryCache = new Map(Object.entries(data.models || {}))
    registryLastUpdated = data.lastUpdated || 0
    console.info('[ModelRegistry] 本地缓存加载完成，模型数:', registryCache.size)
  } catch {
    // 缓存损坏，忽略
    registryCache = null
  }
}

/** 保存缓存到本地 */
function saveCacheSync(): void {
  try {
    if (!registryCache) return
    const filePath = getCacheFilePath()
    const data = {
      models: Object.fromEntries(registryCache),
      lastUpdated: Date.now(),
    }
    fs.writeFileSync(filePath, JSON.stringify(data), 'utf-8')
  } catch {
    // 写入失败不影响主流程
  }
}

/** 从远程注册表拉取模型数据 */
async function fetchRegistry(): Promise<void> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30000)

  try {
    const res = await fetch(REGISTRY_URL, { signal: controller.signal })
    if (!res.ok) {
      console.warn('[ModelRegistry] 远程拉取失败:', res.status)
      return
    }
    const raw = (await res.json()) as Record<string, {
      api?: string
      env?: string[]
      models?: Record<string, {
        id?: string
        tool_call?: boolean
        limit?: { context?: number }
      }>
    }>
    if (!raw || typeof raw !== 'object') {
      console.warn('[ModelRegistry] 远程数据格式异常')
      return
    }

    const newCache = new Map<string, RegistryModelEntry>()
    let modelCount = 0
    for (const provider of Object.values(raw)) {
      if (!provider.models || typeof provider.models !== 'object') continue
      for (const model of Object.values(provider.models)) {
        if (!model.id) continue
        const lowerId = model.id.toLowerCase()
        newCache.set(lowerId, {
          contextWindow: model.limit?.context ?? 4096,
          supportsFunctionCalling: model.tool_call ?? false,
        })
        modelCount++
      }
    }

    registryCache = newCache
    registryLastUpdated = Date.now()
    saveCacheSync()
    console.info(`[ModelRegistry] 远程拉取成功，模型数: ${registryCache.size}`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn('[ModelRegistry] 远程拉取异常:', msg)
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * 初始化模型注册表（应用启动时调用）
 * 1. 加载本地缓存
 * 2. 异步拉取远程注册表（静默失败，使用缓存）
 * 3. 启动定时刷新
 */
export async function initModelRegistry(): Promise<void> {
  loadCacheSync()
  // 异步拉取，不阻塞启动
  fetchRegistry().catch(() => { /* 静默 */ })
  // 定时刷新
  setInterval(() => fetchRegistry().catch(() => { /* 静默 */ }), REFRESH_INTERVAL)
  console.info('[ModelRegistry] 初始化完成')
}

// ════════════════════════════════════════════════════════════════
// 三层查询函数
// ════════════════════════════════════════════════════════════════

/** 自动上下文窗口：注册表 → Provider 默认值 → 4096 */
function getAutoContextWindow(modelName: string, providerId?: string): number {
  const lower = modelName.toLowerCase()

  // Layer 1: 注册表精确匹配
  if (registryCache?.has(lower)) {
    return registryCache.get(lower)!.contextWindow
  }

  // Layer 2: Provider 默认值
  if (providerId) {
    const def = PROVIDER_DEFAULTS[providerId]
    if (def) return def.contextWindow
  }

  // Layer 3: 最终兜底
  return 4096
}

/** 自动 Function Calling 支持：注册表 → Provider 默认值 → true */
function getAutoFC(modelName: string, providerId?: string): boolean {
  const lower = modelName.toLowerCase()

  // Layer 1: 注册表精确匹配
  if (registryCache?.has(lower)) {
    return registryCache.get(lower)!.supportsFunctionCalling
  }

  // Layer 2: Provider 默认值
  if (providerId) {
    const def = PROVIDER_DEFAULTS[providerId]
    if (def) return def.supportsFC
  }

  // Layer 3: 最终兜底
  return true
}

// ════════════════════════════════════════════════════════════════
// 数据库映射辅助
// ════════════════════════════════════════════════════════════════

interface ModelConfigRow {
  id: string
  provider_id: string
  provider_name: string
  model_name: string
  api_key: string
  base_url: string
  enabled: number
  context_window: number
  supports_function_calling: number
  created_at: number
}

function rowToModel(row: ModelConfigRow): ModelConfigItem {
  return {
    id: row.id,
    providerId: row.provider_id,
    providerName: row.provider_name,
    modelName: row.model_name,
    apiKey: row.api_key,
    baseUrl: row.base_url,
    enabled: row.enabled === 1,
    contextWindow: row.context_window,
    supportsFunctionCalling: row.supports_function_calling === 1,
    createdAt: row.created_at,
  }
}

function modelToRow(model: ModelConfigItem): ModelConfigRow {
  return {
    id: model.id,
    provider_id: model.providerId,
    provider_name: model.providerName,
    model_name: model.modelName,
    api_key: model.apiKey,
    base_url: model.baseUrl,
    enabled: model.enabled ? 1 : 0,
    context_window: model.contextWindow,
    supports_function_calling: model.supportsFunctionCalling ? 1 : 0,
    created_at: model.createdAt,
  }
}

export function registerModelHandlers(): void {
  ipcMain.handle('model:list', async () => {
    const db = getDatabaseManager().getDb()
    const rows = db.prepare('SELECT * FROM model_configs ORDER BY created_at DESC').all() as ModelConfigRow[]
    return rows.map(rowToModel)
  })

  ipcMain.handle('model:add', async (_event, config: ModelConfigItem) => {
    const db = getDatabaseManager().getDb()
    const id = `${config.providerId}:${config.modelName}`
    // 三层查询，传入 providerId
    const contextWindow = config.contextWindow || getAutoContextWindow(config.modelName, config.providerId)
    const supportsFunctionCalling = config.supportsFunctionCalling !== undefined
      ? config.supportsFunctionCalling
      : getAutoFC(config.modelName, config.providerId)
    const entry: ModelConfigItem = {
      ...config,
      id,
      contextWindow,
      supportsFunctionCalling,
      createdAt: Date.now()
    }
    const row = modelToRow(entry)
    db.prepare(`
      INSERT OR REPLACE INTO model_configs
        (id, provider_id, provider_name, model_name, api_key, base_url, enabled, context_window, supports_function_calling, created_at)
      VALUES
        (@id, @provider_id, @provider_name, @model_name, @api_key, @base_url, @enabled, @context_window, @supports_function_calling, @created_at)
    `).run(row)
    return { success: true }
  })

  ipcMain.handle('model:remove', async (_event, { id }) => {
    const db = getDatabaseManager().getDb()
    const result = db.prepare('DELETE FROM model_configs WHERE id = ?').run(id)
    return { success: result.changes > 0 }
  })

  ipcMain.handle('model:update', async (_event, { id, config }: { id: string; config: Partial<ModelConfigItem> }) => {
    const db = getDatabaseManager().getDb()
    // 如果更新了 modelName 则重新计算上下文
    if (config.modelName) {
      config.contextWindow = config.contextWindow || getAutoContextWindow(config.modelName, config.providerId)
    }
    // 构建动态 SET 子句
    const sets: string[] = []
    const params: Record<string, unknown> = {}
    if (config.providerId !== undefined) { sets.push('provider_id = @provider_id'); params.provider_id = config.providerId }
    if (config.providerName !== undefined) { sets.push('provider_name = @provider_name'); params.provider_name = config.providerName }
    if (config.modelName !== undefined) { sets.push('model_name = @model_name'); params.model_name = config.modelName }
    if (config.apiKey !== undefined) { sets.push('api_key = @api_key'); params.api_key = config.apiKey }
    if (config.baseUrl !== undefined) { sets.push('base_url = @base_url'); params.base_url = config.baseUrl }
    if (config.enabled !== undefined) { sets.push('enabled = @enabled'); params.enabled = config.enabled ? 1 : 0 }
    if (config.contextWindow !== undefined) { sets.push('context_window = @context_window'); params.context_window = config.contextWindow }
    if (config.supportsFunctionCalling !== undefined) { sets.push('supports_function_calling = @supports_function_calling'); params.supports_function_calling = config.supportsFunctionCalling ? 1 : 0 }
    if (sets.length === 0) return { success: false }
    params.id = id
    const result = db.prepare(`UPDATE model_configs SET ${sets.join(', ')} WHERE id = @id`).run(params)
    return { success: result.changes > 0 }
  })

  // 获取可用 Provider 列表（含国产 + HuggingFace）
  ipcMain.handle('provider:full-list', async () => {
    return Object.entries(PROVIDER_INFO).map(([id, info]) => ({
      id,
      name: info.name,
      baseUrl: info.baseUrl
    }))
  })

  // 获取模型自动上下文（支持传入 providerId）
  ipcMain.handle('model:auto-context', async (_event, { modelName, providerId }: { modelName: string; providerId?: string }) => {
    return {
      contextWindow: getAutoContextWindow(modelName, providerId),
      supportsFunctionCalling: getAutoFC(modelName, providerId),
    }
  })

  // 测试连接
  ipcMain.handle('model:test-connection', async (_event, { baseUrl, apiKey, modelName, providerId }: { baseUrl: string; apiKey: string; modelName: string; providerId: string }) => {
    const normalizedUrl = baseUrl.replace(/\/+$/, '')
    const startTime = Date.now()

    try {
      let result: { success: boolean; message: string; latencyMs: number }

      if (providerId === 'ollama') {
        // Ollama 使用 /api/tags
        const res = await fetch(`${normalizedUrl}/api/tags`, {
          method: 'GET',
          signal: AbortSignal.timeout(10000),
        })
        const latency = Date.now() - startTime
        if (res.ok) {
          result = { success: true, message: '连接成功', latencyMs: latency }
        } else {
          result = { success: false, message: `连接失败 (${res.status})`, latencyMs: latency }
        }
      } else {
        // OpenAI 兼容接口：发送最小 chat completion 请求
        const res = await fetch(`${normalizedUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: apiKey.startsWith('Bearer ') ? apiKey : `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: modelName,
            messages: [{ role: 'user', content: 'hi' }],
            max_tokens: 1,
          }),
          signal: AbortSignal.timeout(15000),
        })
        const latency = Date.now() - startTime

        if (res.ok) {
          result = { success: true, message: '连接成功', latencyMs: latency }
        } else if (res.status === 401 || res.status === 403) {
          result = { success: false, message: 'API Key 无效或权限不足', latencyMs: latency }
        } else if (res.status === 404) {
          // 可能是路径不对，尝试 GET /models 轻量检查
          const fallbackRes = await fetch(`${normalizedUrl}/models`, {
            method: 'GET',
            headers: { Authorization: `Bearer ${apiKey}` },
            signal: AbortSignal.timeout(5000),
          })
          if (fallbackRes.ok) {
            result = { success: true, message: '连接成功', latencyMs: Date.now() - startTime }
          } else {
            const body = await res.json().catch(() => ({}))
            result = { success: false, message: body?.error?.message || `请求失败 (${res.status})`, latencyMs: latency }
          }
        } else {
          const body = await res.json().catch(() => ({}))
          result = { success: false, message: body?.error?.message || `请求失败 (${res.status})`, latencyMs: latency }
        }
      }

      return result
    } catch (err) {
      const latency = Date.now() - startTime
      const message = err instanceof Error
        ? (err.name === 'TimeoutError' || err.name === 'AbortError' ? '连接超时' : err.message)
        : '连接失败'
      return { success: false, message, latencyMs: latency }
    }
  })

  // ── llm:usage — 查询 LLM 用量统计 ──
  ipcMain.handle('llm:usage', async (_event, { period }: { period: string }): Promise<UsageStats> => {
    try {
      const observer = getLLMObserver()
      const allRecords = observer.query({ limit: 10000 })

      const now = Date.now()
      const todayStart = new Date()
      todayStart.setHours(0, 0, 0, 0)
      const todayStartMs = todayStart.getTime()
      const monthAgo = now - 30 * 24 * 60 * 60 * 1000

      // 今日用量
      const todayRecords = allRecords.filter(r => r.timestamp >= todayStartMs && r.success)
      const todayTokens = todayRecords.reduce((sum, r) => sum + r.totalTokens, 0)

      // 本月用量（近30天）
      const monthRecords = allRecords.filter(r => r.timestamp >= monthAgo && r.success)
      const monthTokens = monthRecords.reduce((sum, r) => sum + r.totalTokens, 0)

      // 每日用量（近7天）
      const dailyUsage: { date: string; tokens: number }[] = []
      const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000
      const recentRecords = allRecords.filter(r => r.timestamp >= sevenDaysAgo && r.success)
      for (let i = 6; i >= 0; i--) {
        const dayStart = new Date()
        dayStart.setDate(dayStart.getDate() - i)
        dayStart.setHours(0, 0, 0, 0)
        const dayStartMs = dayStart.getTime()
        const dayEndMs = dayStartMs + 24 * 60 * 60 * 1000
        const dayRecords = recentRecords.filter(r => r.timestamp >= dayStartMs && r.timestamp < dayEndMs)
        const tokens = dayRecords.reduce((sum, r) => sum + r.totalTokens, 0)
        const date = `${dayStart.getMonth() + 1}/${dayStart.getDate()}`
        dailyUsage.push({ date, tokens })
      }

      return { todayTokens, monthTokens, dailyUsage }
    } catch (err) {
      console.error('[llm:usage] 查询失败:', err)
      return { todayTokens: 0, monthTokens: 0, dailyUsage: [] }
    }
  })

  // ── llm:context-tokens — 查询上下文 Token 用量 ──
  ipcMain.handle('llm:context-tokens', async (_event, { workspaceId }: { workspaceId: string }): Promise<ContextTokenInfo> => {
    try {
      const store = getChatHistoryStore()
      if (!store) {
        return { used: 0, max: 128000, percentage: 0, breakdown: { system: 0, history: 0, tools: 0, state: 0 } }
      }

      // 查询所有 agent 的历史 token 总量作为「已用」
      const stats = await store.getStats(workspaceId, '')
      const used = stats.totalTokens
      const max = 128000 // 默认上下文窗口，后续可从模型配置获取
      const percentage = max > 0 ? (used / max) * 100 : 0

      // 粗略拆分：按 role 估算
      const breakdown = {
        system: Math.round(used * 0.1),   // 估算系统提示词约占 10%
        history: Math.round(used * 0.7),   // 历史对话约占 70%
        tools: Math.round(used * 0.15),    // 工具定义约占 15%
        state: Math.round(used * 0.05),    // 状态信息约占 5%
      }

      return { used, max, percentage, breakdown }
    } catch (err) {
      console.error('[llm:context-tokens] 查询失败:', err)
      return { used: 0, max: 128000, percentage: 0, breakdown: { system: 0, history: 0, tools: 0, state: 0 } }
    }
  })
}