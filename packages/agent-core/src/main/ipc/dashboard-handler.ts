import { ipcMain } from 'electron'

/** 模拟仪表盘数据 */
const mockStats = {
  todayTokens: 12847,
  monthTokens: 284193,
  totalTokens: 1234567,
  activeConnections: 2,
  totalAgents: 3,
  onlineAgents: 2,
  providerDistribution: [
    { providerId: 'openai', providerName: 'OpenAI', tokenCount: 680000, percentage: 55.1, callCount: 3400 },
    { providerId: 'claude', providerName: 'Claude', tokenCount: 320000, percentage: 25.9, callCount: 1200 },
    { providerId: 'gemini', providerName: 'Gemini', tokenCount: 180000, percentage: 14.6, callCount: 800 },
    { providerId: 'ollama', providerName: 'Ollama (本地)', tokenCount: 54567, percentage: 4.4, callCount: 450 }
  ],
  topModels: [
    { modelId: 'gpt-4o', modelName: 'GPT-4o', providerId: 'openai', tokenCount: 380000, callCount: 1900 },
    { modelId: 'claude-3.5-sonnet', modelName: 'Claude 3.5 Sonnet', providerId: 'claude', tokenCount: 220000, callCount: 800 },
    { modelId: 'gpt-4o-mini', modelName: 'GPT-4o Mini', providerId: 'openai', tokenCount: 300000, callCount: 1500 },
    { modelId: 'gemini-2.0-flash', modelName: 'Gemini 2.0 Flash', providerId: 'gemini', tokenCount: 180000, callCount: 800 },
    { modelId: 'qwen2.5:7b', modelName: 'Qwen 2.5 7B', providerId: 'ollama', tokenCount: 54567, callCount: 450 }
  ]
}

/** 生成模拟每日用量数据 */
function generateMockDailyUsage(days: number): { date: string; tokens: number; callCount: number }[] {
  const result: { date: string; tokens: number; callCount: number }[] = []
  const now = Date.now()
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now - i * 86400000)
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    result.push({
      date,
      tokens: Math.floor(Math.random() * 50000) + 5000,
      callCount: Math.floor(Math.random() * 300) + 50
    })
  }
  return result
}

/** 生成模拟活跃时段数据 */
function generateMockActivity(): { workspaceId: string; workspaceName: string; hourlyActivity: number[]; dailyActivity: number[] }[] {
  return [
    {
      workspaceId: 'ws-1',
      workspaceName: 'Chili6668267',
      hourlyActivity: Array.from({ length: 24 }, () => Math.floor(Math.random() * 20)),
      dailyActivity: Array.from({ length: 7 }, () => Math.floor(Math.random() * 100) + 20)
    },
    {
      workspaceId: 'ws-2',
      workspaceName: 'hads',
      hourlyActivity: Array.from({ length: 24 }, () => Math.floor(Math.random() * 15)),
      dailyActivity: Array.from({ length: 7 }, () => Math.floor(Math.random() * 80) + 10)
    }
  ]
}

export function registerDashboardHandlers(): void {
  ipcMain.handle('dashboard:stats', async () => {
    return { ...mockStats }
  })

  ipcMain.handle('dashboard:usage-history', async (_event, { days = 7 }) => {
    return generateMockDailyUsage(days)
  })

  ipcMain.handle('dashboard:agent-activity', async () => {
    return generateMockActivity()
  })
}