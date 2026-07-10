import { ipcMain } from 'electron'
import type { ModelConfigItem } from '../../renderer/src/lib/types'

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

/** 模型配置存储（用户添加的模型） */
const mockModels: ModelConfigItem[] = []

export function registerModelHandlers(): void {
  ipcMain.handle('model:list', async () => {
    return [...mockModels]
  })

  ipcMain.handle('model:add', async (_event, config: ModelConfigItem) => {
    const id = `${config.providerId}:${config.modelName}`
    // 自动设置上下文窗口
    const contextWindow = getAutoContextWindow(config.modelName)
    // 自动设置 Function Calling 支持
    const supportsFunctionCalling = getAutoFC(config.modelName)
    // 如果已存在则更新，否则添加
    const existingIdx = mockModels.findIndex(m => m.id === id)
    const entry: ModelConfigItem = {
      ...config,
      id,
      contextWindow: config.contextWindow || contextWindow,
      supportsFunctionCalling: config.supportsFunctionCalling !== undefined ? config.supportsFunctionCalling : supportsFunctionCalling,
      createdAt: Date.now()
    }
    if (existingIdx !== -1) {
      mockModels[existingIdx] = entry
    } else {
      mockModels.push(entry)
    }
    return { success: true }
  })

  ipcMain.handle('model:remove', async (_event, { id }) => {
    const idx = mockModels.findIndex(m => m.id === id)
    if (idx !== -1) {
      mockModels.splice(idx, 1)
      return { success: true }
    }
    return { success: false }
  })

  ipcMain.handle('model:update', async (_event, { id, config }: { id: string; config: Partial<ModelConfigItem> }) => {
    const model = mockModels.find(m => m.id === id)
    if (model) {
      // 如果更新了 modelName 则重新计算上下文
      if (config.modelName) {
        config.contextWindow = config.contextWindow || getAutoContextWindow(config.modelName)
      }
      Object.assign(model, config)
      return { success: true }
    }
    return { success: false }
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