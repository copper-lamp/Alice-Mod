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
}