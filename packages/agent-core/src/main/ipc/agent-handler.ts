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

      // V24: 若启用了 QQ 绑定，异步预热 MainAgent 实例
      if (config.qqBinding?.enabled && id) {
        warmupAgent(id, config).catch(err =>
          console.warn(`[AgentHandler] 预热 Agent ${id} 失败:`, err),
        )
      }

      return { id, success: true }
    } catch (err) {
      return { id: '', success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('agent:update', async (_event, { id, config }) => {
    const success = await agentConfigManager.update(id, config)
    // V24: 配置更新后失效缓存，下次触发时重新构造
    if (success) {
      const { getMainAgentRegistry } = await import('./index')
      getMainAgentRegistry().invalidate('', id)
    }
    return { success }
  })

  ipcMain.handle('agent:delete', async (_event, { id }) => {
    const success = await agentConfigManager.delete(id)
    // V24: 删除后失效缓存
    if (success) {
      const { getMainAgentRegistry } = await import('./index')
      getMainAgentRegistry().invalidate('', id)
    }
    return { success }
  })

  // V24: 获取 Agent 运行时状态（含 QQ 连接状态）
  ipcMain.handle('agent:get-status', async (_event, { id }) => {
    const config = await agentConfigManager.get(id)
    if (!config) return { status: 'not_found' }

    const workspaceId = config.workspaceId ?? ''
    const { getMainAgentRegistry } = await import('./index')
    const registry = getMainAgentRegistry()
    const agent = registry.getSync(workspaceId, id)

    if (!agent) {
      return { status: 'initializing', qqStatus: 'disconnected' }
    }

    // 获取 QQ 连接状态
    let qqStatus = 'disconnected'
    if (config.qqBinding?.enabled && config.qqBinding.accountId) {
      try {
        const { activeClients } = await import('./qq-bot-handler')
        const client = activeClients.get(config.qqBinding.accountId)
        if (client) {
          qqStatus = client.getStatus()
        }
      } catch {
        // qq-bot-handler 可能未注册
      }
    }

    return {
      status: 'ready',
      qqStatus,
      roundLimit: 5,
    }
  })
}

/**
 * V24: 异步预热 Agent 的 MainAgent 实例
 * 创建 Agent 后立即通过 MainAgentRegistry.get() 构造并缓存 MainAgent，
 * 这样首次 QQ 消息到达时无需等待异步构造
 */
async function warmupAgent(agentId: string, config: AgentConfig): Promise<void> {
  const { getMainAgentRegistry } = await import('./index')
  const registry = getMainAgentRegistry()
  const workspaceId = config.workspaceId ?? ''
  const agent = await registry.get(workspaceId, agentId)
  if (agent) {
    console.log(`[AgentHandler] Agent ${agentId} 预热成功`)
  }
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
