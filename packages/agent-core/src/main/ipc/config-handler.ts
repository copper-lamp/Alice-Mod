import { ipcMain } from 'electron'

/** 模拟配置存储 */
const mockConfig: Record<string, { value: string; valueType: string; description: string }> = {
  llm_selected_provider: { value: 'openai', valueType: 'string', description: 'LLM Provider' },
  llm_selected_model: { value: 'gpt-4o', valueType: 'string', description: 'LLM 模型' },
  llm_temperature: { value: '0.7', valueType: 'number', description: '温度参数' },
  llm_max_tokens: { value: '4096', valueType: 'number', description: '最大 Token 数' },
  tcp_port: { value: '27541', valueType: 'number', description: 'TCP 服务端端口' }
}

export function registerConfigHandlers(): void {
  ipcMain.handle('config:get', async (_event, { key }) => {
    const entry = mockConfig[key]
    return entry ? { key, ...entry } : null
  })

  ipcMain.handle('config:set', async (_event, { key, value }) => {
    if (mockConfig[key]) {
      mockConfig[key].value = value
    } else {
      mockConfig[key] = { value, valueType: 'string', description: '' }
    }
    console.log(`[config:set] ${key}=${value}`)
    return { success: true }
  })

  ipcMain.handle('config:getAll', async () => {
    return Object.entries(mockConfig).map(([key, entry]) => ({
      key,
      ...entry
    }))
  })

  ipcMain.handle('provider:list', async () => {
    return [
      { id: 'openai', name: 'OpenAI', available: true, latencyMs: 120 },
      { id: 'claude', name: 'Claude', available: true, latencyMs: 150 },
      { id: 'gemini', name: 'Gemini', available: true, latencyMs: 100 },
      { id: 'ollama', name: 'Ollama (本地)', available: false, latencyMs: 0 }
    ]
  })

  ipcMain.handle('model:list', async (_event, { providerId }) => {
    const models: Record<string, { id: string; name: string; providerId: string; supportsFunctionCalling: boolean; contextWindow: number }[]> = {
      openai: [
        { id: 'gpt-4o', name: 'GPT-4o', providerId: 'openai', supportsFunctionCalling: true, contextWindow: 128000 },
        { id: 'gpt-4o-mini', name: 'GPT-4o Mini', providerId: 'openai', supportsFunctionCalling: true, contextWindow: 128000 }
      ],
      claude: [
        { id: 'claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', providerId: 'claude', supportsFunctionCalling: true, contextWindow: 200000 },
        { id: 'claude-3.5-haiku', name: 'Claude 3.5 Haiku', providerId: 'claude', supportsFunctionCalling: true, contextWindow: 200000 }
      ],
      gemini: [
        { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', providerId: 'gemini', supportsFunctionCalling: true, contextWindow: 1048576 }
      ],
      ollama: [
        { id: 'qwen2.5:7b', name: 'Qwen 2.5 7B', providerId: 'ollama', supportsFunctionCalling: true, contextWindow: 32768 }
      ]
    }
    return models[providerId] || []
  })
}