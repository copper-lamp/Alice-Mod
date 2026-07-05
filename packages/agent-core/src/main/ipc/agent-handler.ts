import { ipcMain } from 'electron'
import type { AgentConfig, AgentSummary } from '../../renderer/src/lib/types'

/** 内存中的智能体配置管理器 */
class AgentConfigManager {
  private configs: Map<string, AgentConfig> = new Map()
  private nextId = 3

  /** 预置示例数据 */
  constructor() {
    this.configs.set('agent-1', {
      id: 'agent-1',
      name: 'Chili6668267',
      identity: { selectedFragments: ['mining', 'building'] },
      tools: { categorySelection: { perception: true, survival: true, qq: false } },
      memory: { mode: 'both' },
      executionRules: [
        { id: 'auto-eat', name: '自动进食', description: '当饥饿值 < 6 时自动吃背包食物', enabled: true },
        { id: 'auto-equip', name: '自动装备', description: '当获得更好装备时自动更换', enabled: true },
        { id: 'safe-first', name: '安全优先', description: '血量 < 30% 时停止战斗', enabled: false }
      ],
      qqBinding: { enabled: true, accountId: 'robot-1', groupIds: ['group-1'] },
      schedule: { mode: 'always' },
      createdAt: Date.now() - 86400000 * 7,
      updatedAt: Date.now() - 3600000
    })
    this.configs.set('agent-2', {
      id: 'agent-2',
      name: 'hads',
      identity: { selectedFragments: ['combat'] },
      tools: { categorySelection: { perception: true, survival: true, qq: false } },
      memory: { mode: 'sqlite' },
      executionRules: [
        { id: 'auto-eat', name: '自动进食', description: '当饥饿值 < 6 时自动吃背包食物', enabled: true }
      ],
      qqBinding: { enabled: false },
      schedule: { mode: 'scheduled', startTime: '08:00', endTime: '22:00', timezone: 'UTC+8' },
      createdAt: Date.now() - 86400000 * 3,
      updatedAt: Date.now() - 1800000
    })
  }

  async create(config: AgentConfig): Promise<string> {
    const id = `agent-${this.nextId++}`
    config.id = id
    config.createdAt = Date.now()
    config.updatedAt = Date.now()
    this.configs.set(id, { ...config })
    return id
  }

  async update(id: string, config: Partial<AgentConfig>): Promise<boolean> {
    const existing = this.configs.get(id)
    if (!existing) return false
    Object.assign(existing, config, { updatedAt: Date.now() })
    return true
  }

  async delete(id: string): Promise<boolean> {
    return this.configs.delete(id)
  }

  list(): AgentSummary[] {
    return Array.from(this.configs.values()).map(c => ({
      id: c.id!,
      name: c.name,
      status: c.id === 'agent-1' ? 'online' : 'offline',
      toolCount: Object.values(c.tools.categorySelection).filter(Boolean).length,
      lastActiveAt: c.updatedAt,
      workspaceId: c.id === 'agent-1' ? 'ws-1' : undefined
    }))
  }

  get(id: string): AgentConfig | undefined {
    const config = this.configs.get(id)
    return config ? { ...config } : undefined
  }
}

const agentConfigManager = new AgentConfigManager()

export function registerAgentHandlers(): void {
  ipcMain.handle('agent:list', async () => {
    return agentConfigManager.list()
  })

  ipcMain.handle('agent:get', async (_event, { id }) => {
    return agentConfigManager.get(id) ?? null
  })

  ipcMain.handle('agent:create', async (_event, config: AgentConfig) => {
    const id = await agentConfigManager.create(config)
    return { id, success: true }
  })

  ipcMain.handle('agent:update', async (_event, { id, config }) => {
    const success = await agentConfigManager.update(id, config)
    return { success }
  })

  ipcMain.handle('agent:delete', async (_event, { id }) => {
    const success = await agentConfigManager.delete(id)
    return { success }
  })
}