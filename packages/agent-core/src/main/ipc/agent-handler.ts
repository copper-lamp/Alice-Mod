import { ipcMain } from 'electron'
import { AgentConfigManager } from '../agent/agent-config-manager'
import type { AgentConfig } from '../../renderer/src/lib/types'

const agentConfigManager = new AgentConfigManager()

export function registerAgentHandlers(): void {
  ipcMain.handle('agent:list', async () => {
    return await agentConfigManager.list()
  })

  ipcMain.handle('agent:get', async (_event, { id }) => {
    return await agentConfigManager.get(id) ?? null
  })

  ipcMain.handle('agent:create', async (_event, config: AgentConfig) => {
    try {
      const id = await agentConfigManager.create(config)
      return { id, success: true }
    } catch (err) {
      return { id: '', success: false, error: (err as Error).message }
    }
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
