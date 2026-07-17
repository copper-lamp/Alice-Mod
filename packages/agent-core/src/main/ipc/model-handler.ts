import { ipcMain } from 'electron'
import type { ModelConfigItem } from '../../renderer/src/lib/types'
import { getDatabaseManager } from '../database'

/** 模型名 → 上下文窗口大小（自动设置） */
const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  // OpenAI
  'gpt-4o': 128000,
  'gpt-4o-mini': 128000,
  'gpt-4-turbo': 128000,
  'gpt-3.5-turbo': 16384,
  // Claude
  'claude-3.5-sonnet': 200000,
  'claude-3.5-haiku': 200000,
  'claude-3-opus': 200000,
  // Gemini
  'gemini-2.0-flash': 1048576,
  'gemini-1.5-pro': 1048576,
  'gemini-1.5-flash': 1048576,
  // Ollama
  'llama3': 8192,
  'qwen2.5': 32768,
  'mistral': 8192,
  'codellama': 16384,
  // DeepSeek
  'deepseek-chat': 65536,
  'deepseek-coder': 65536,
  'deepseek-reasoner': 65536,
  // 通义千问 (Qwen)
  'qwen-turbo': 32768,
  'qwen-plus': 131072,
  'qwen-max': 32768,
  'qwen-long': 10000000,
  // 月之暗面 (Moonshot/Kimi)
  'moonshot-v1-8k': 8192,
  'moonshot-v1-32k': 32768,
  'moonshot-v1-128k': 131072,
  // 智谱 (GLM/Zhipu)
  'glm-4-plus': 131072,
  'glm-4-air': 131072,
  'glm-4-flash': 131072,
  'glm-4v-plus': 131072,
  // 百度文心 (ERNIE)
  'ernie-4.0-turbo': 131072,
  'ernie-4.0': 131072,
  'ernie-3.5': 131072,
  'ernie-speed': 131072,
  // 字节豆包 (Doubao)
  'doubao-pro-32k': 32768,
  'doubao-pro-128k': 131072,
  'doubao-lite-32k': 32768,
  // 零一万物 (Yi)
  'yi-lightning': 16384,
  'yi-medium': 16384,
  'yi-large': 32768,
  'yi-vision': 16384,
  // 百川 (Baichuan)
  'baichuan4': 32768,
  'baichuan3-turbo': 32768,
  'baichuan3': 32768,
  // MiniMax
  'minimax-abab6.5': 16384,
  'minimax-abab5.5': 16384,
  // 讯飞星火 (Spark)
  'spark-4.0-ultra': 8192,
  'spark-3.5-max': 8192,
  'spark-3.1': 8192,
  // SenseTime 商汤 (SenseChat)
  'sensechat-5': 131072,
  'sensechat-turbo': 131072,
  // StepFun 阶跃星辰
  'step-1': 8192,
  'step-1v': 8192,
}

/** 模型名 → 是否支持 Function Calling */
const MODEL_FC_SUPPORT: Record<string, boolean> = {
  'gpt-4o': true,
  'gpt-4o-mini': true,
  'gpt-4-turbo': true,
  'gpt-3.5-turbo': true,
  'claude-3.5-sonnet': true,
  'claude-3.5-haiku': true,
  'deepseek-chat': true,
  'deepseek-coder': true,
  'qwen-plus': true,
  'qwen-max': true,
  'glm-4-plus': true,
  'glm-4-air': true,
  'glm-4-flash': true,
  'ernie-4.0-turbo': true,
  'doubao-pro-32k': true,
  'doubao-pro-128k': true,
  'yi-large': true,
  'baichuan4': true,
}

const PROVIDER_INFO: Record<string, { name: string; baseUrl: string; apiKey: string }> = {
  openai: { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-****' },
  claude: { name: 'Claude', baseUrl: 'https://api.anthropic.com/v1', apiKey: 'sk-****' },
  gemini: { name: 'Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', apiKey: 'AI****' },
  ollama: { name: 'Ollama (本地)', baseUrl: 'http://127.0.0.1:11434', apiKey: '' },
  deepseek: { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'sk-****' },
  qwen: { name: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', apiKey: 'sk-****' },
  moonshot: { name: '月之暗面 (Kimi)', baseUrl: 'https://api.moonshot.cn/v1', apiKey: 'sk-****' },
  zhipu: { name: '智谱 (GLM)', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', apiKey: '****' },
  ernie: { name: '百度文心 (ERNIE)', baseUrl: 'https://aip.baidubce.com/rpc/2.0/ai_custom', apiKey: '****' },
  doubao: { name: '字节豆包', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', apiKey: '****' },
  yi: { name: '零一万物 (Yi)', baseUrl: 'https://api.lingyiwanwu.com/v1', apiKey: '****' },
  baichuan: { name: '百川 (Baichuan)', baseUrl: 'https://api.baichuan-ai.com/v1', apiKey: 'sk-****' },
  minimax: { name: 'MiniMax', baseUrl: 'https://api.minimax.chat/v1', apiKey: 'sk-****' },
  spark: { name: '讯飞星火', baseUrl: 'https://spark-api.xf-yun.com/v3.5/chat', apiKey: '****' },
  sensechat: { name: '商汤 (SenseChat)', baseUrl: 'https://api.sensetime.com/v1', apiKey: '****' },
  stepfun: { name: '阶跃星辰 (StepFun)', baseUrl: 'https://api.stepfun.com/v1', apiKey: '****' },
}

/** 生成自动上下文窗口 */
function getAutoContextWindow(modelName: string): number {
  const lower = modelName.toLowerCase()
  for (const [key, value] of Object.entries(MODEL_CONTEXT_WINDOWS)) {
    if (lower.includes(key) || lower === key) return value
  }
  // 默认值
  return 4096
}

function getAutoFC(modelName: string): boolean {
  const lower = modelName.toLowerCase()
  for (const [key, value] of Object.entries(MODEL_FC_SUPPORT)) {
    if (lower.includes(key) || lower === key) return value
  }
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
    // 自动设置上下文窗口
    const contextWindow = getAutoContextWindow(config.modelName)
    // 自动设置 Function Calling 支持
    const supportsFunctionCalling = getAutoFC(config.modelName)
    const entry: ModelConfigItem = {
      ...config,
      id,
      contextWindow: config.contextWindow || contextWindow,
      supportsFunctionCalling: config.supportsFunctionCalling !== undefined ? config.supportsFunctionCalling : supportsFunctionCalling,
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
      config.contextWindow = config.contextWindow || getAutoContextWindow(config.modelName)
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

  // 获取可用 Provider 列表（含国产）
  ipcMain.handle('provider:full-list', async () => {
    return Object.entries(PROVIDER_INFO).map(([id, info]) => ({
      id,
      name: info.name,
      baseUrl: info.baseUrl
    }))
  })

  // 获取模型自动上下文
  ipcMain.handle('model:auto-context', async (_event, { modelName }: { modelName: string }) => {
    return { contextWindow: getAutoContextWindow(modelName), supportsFunctionCalling: getAutoFC(modelName) }
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
}