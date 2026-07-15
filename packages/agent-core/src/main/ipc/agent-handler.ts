import { ipcMain } from 'electron'
import { AgentConfigManager } from '../agent/agent-config-manager'
import { AgentFileExporter } from '../agent/agent-file-exporter'
import type { AgentConfig } from '../../renderer/src/lib/types'

/**
 * V20：共享的 AgentConfigManager 单例。
 *
 * 历史上是模块级私有 const，V20 主链路组装（MainAgentRegistry / resolveTargetFactory）
 * 也需要访问同一实例以避免缓存不一致，故导出。
 */
const agentConfigManager = new AgentConfigManager()

/** V20：供 ipc/index.ts 的 bootstrapAndWireAgents 复用同一实例 */
export function getSharedAgentConfigManager(): AgentConfigManager {
  return agentConfigManager
}

export function registerAgentHandlers(): void {
  // V21: 启动时全量导出已有智能体配置到模组目录
  exportAllAgents().catch(err =>
    console.warn('[AgentHandler] 启动时全量导出失败:', err)
  )
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

/**
 * 启动时全量导出已有智能体配置到模组目录
 * 确保 AC 重启后 Alice/agents/ 目录下的配置文件与 SQLite 同步
 */
async function exportAllAgents(): Promise<void> {
  const agents = await agentConfigManager.list()
  for (const summary of agents) {
    const config = await agentConfigManager.get(summary.id)
    if (config) {
      await AgentFileExporter.export(config)
    }
  }
  console.log(`[AgentHandler] 已导出 ${agents.length} 个智能体配置到模组目录`)
}
