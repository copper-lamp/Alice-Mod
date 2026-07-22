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
      // 如果没有指定 workspaceId，自动分配第一个在线工作区
      if (!config.workspaceId) {
        const { getWorkspaceManager } = await import('../workspace')
        const onlineWorkspaces = getWorkspaceManager().getOnlineWorkspaces()
        if (onlineWorkspaces.length > 0) {
          config.workspaceId = onlineWorkspaces[0].id
          console.log(`[AgentHandler] 自动分配 workspaceId=${config.workspaceId} 给新智能体`)
        }
      }

      const id = await agentConfigManager.create(config)

      // 导出配置到模组目录 Alice/agents/<id>.json
      if (id) {
        const configWithId = { ...config, id }
        AgentFileExporter.export(configWithId).catch(err =>
          console.warn(`[AgentHandler] 导出智能体 ${id} 配置文件失败:`, err),
        )
      }

      // V24: 若启用了 QQ 绑定，异步预热 MainAgent 实例
      if (config.qqBinding?.enabled && id) {
        warmupAgent(id, config).catch(err =>
          console.warn(`[AgentHandler] 预热 Agent ${id} 失败:`, err),
        )
      }

      // V32: 同步创建定时触发器
      if (id && config.schedule && config.schedule.mode !== 'disabled') {
        syncAgentTrigger(id, config).catch(err =>
          console.warn(`[AgentHandler] 创建 Agent 触发器失败:`, err),
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

      // V32: 同步更新/删除定时触发器
      syncAgentTrigger(id, { ...config, id }).catch(err =>
        console.warn(`[AgentHandler] 更新 Agent 触发器失败:`, err),
      )
    }
    return { success }
  })

  ipcMain.handle('agent:delete', async (_event, { id }) => {
    const success = await agentConfigManager.delete(id)
    // V24: 删除后失效缓存
    if (success) {
      const { getMainAgentRegistry } = await import('./index')
      getMainAgentRegistry().invalidate('', id)

      // V32: 删除定时触发器
      removeAgentTrigger(id).catch(err =>
        console.warn(`[AgentHandler] 删除 Agent 触发器失败:`, err),
      )
    }
    return { success }
  })

  // V28: 设置智能体启用/禁用
  ipcMain.handle('agent:set-enabled', async (_event, { id, enabled }: { id: string; enabled: boolean }) => {
    const updateResult = await agentConfigManager.update(id, { enabled })
    if (updateResult) {
      const { getMainAgentRegistry } = await import('./index')
      getMainAgentRegistry().invalidate('', id)
    }
    return { success: updateResult }
  })

  // V28: 控制假人上线/下线
  ipcMain.handle('agent:bot-control', async (_event, { id, action }: { id: string; action: 'online' | 'offline' }) => {
    const config = await agentConfigManager.get(id)
    if (!config) return { success: false, error: '智能体不存在' }

    const workspaceId = config.workspaceId ?? ''
    const { getConnectionResolver } = await import('./index')
    const resolver = getConnectionResolver()
    if (!resolver) return { success: false, error: 'ConnectionResolver 未就绪' }

    try {
      const conn = resolver.resolve(workspaceId)
      const resp = await conn.sendRequestAndAwait('bot_control', {
        action,
        bot_name: config.name,
      }, { timeoutMs: 15_000 })
      if ('error' in resp && resp.error) {
        return { success: false, error: `[${resp.error.code}] ${resp.error.message}` }
      }
      return { success: true, data: (resp as any).result }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
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

    // V28: 获取假人上线状态
    let botOnline = false
    try {
      const { getConnectionResolver } = await import('./index')
      const resolver = getConnectionResolver()
      if (resolver) {
        const conn = resolver.resolve(workspaceId)
        const resp = await conn.sendRequestAndAwait('bot_control', {
          action: 'status',
          bot_name: config.name,
        }, { timeoutMs: 5_000 })
        if (!('error' in resp) || !resp.error) {
          botOnline = (resp as any).result?.online === true
        }
      }
    } catch {
      // 连接未就绪或适配器不支持，忽略
    }

    return {
      status: 'ready',
      qqStatus,
      botOnline,
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

// ════════════════════════════════════════════════════════════════
// V32: 定时触发器同步
// ════════════════════════════════════════════════════════════════

/**
 * 根据 Agent 的 schedule 配置，在 TriggerModule 中创建或更新定时触发器
 */
async function syncAgentTrigger(agentId: string, config: AgentConfig): Promise<void> {
  const schedule = config.schedule
  if (!schedule || schedule.mode === 'disabled') {
    // 关闭定时触发 → 删除已有触发器
    await removeAgentTrigger(agentId)
    return
  }

  let triggerModule: import('../trigger/index').TriggerModule
  try {
    const { getTriggerModule } = await import('../trigger/index')
    triggerModule = getTriggerModule()
  } catch {
    console.warn('[AgentHandler] TriggerModule 未就绪，跳过触发器同步')
    return
  }

  const triggerId = `agent-schedule-${agentId}`
  const existing = triggerModule.getTrigger(triggerId)

  const workspaceId = config.workspaceId ?? ''
  const prompt = schedule.prompt ?? '执行定时任务'

  // 构造 action: send_llm → qq_sub_agent
  const action = {
    type: 'send_llm' as const,
    config: {
      target: 'qq_sub_agent' as const,
      prompt,
      includeEventContext: true,
    },
  }

  // 构造 rule 和 schedule
  if (schedule.mode === 'cron' && schedule.cronExpression) {
    if (existing) {
      triggerModule.updateTrigger(triggerId, {
        rule: { type: 'cron', value: schedule.cronExpression },
        action,
        targetAgentId: agentId,
        enabled: true,
      })
    } else {
      // 创建新触发器
      triggerModule.createTrigger(
        {
          workspaceId,
          name: `Agent ${config.name} 定时触发`,
          description: `Agent ${config.name} 的 QQ 定时触发（${schedule.cronExpression}）`,
          source: 'cron',
          priority: 0,
          rule: { type: 'cron', value: schedule.cronExpression },
          action,
          cooldownSeconds: 0,
          enabled: true,
          targetAgentId: agentId,
        },
        {
          triggerId,
          scheduleType: 'cron',
          cronExpression: schedule.cronExpression,
        },
      )
    }
  } else if (schedule.mode === 'interval' && schedule.intervalSeconds && schedule.intervalSeconds > 0) {
    if (existing) {
      triggerModule.updateTrigger(triggerId, {
        rule: { type: 'interval', value: schedule.intervalSeconds },
        action,
        targetAgentId: agentId,
        enabled: true,
      })
    } else {
      triggerModule.createTrigger(
        {
          workspaceId,
          name: `Agent ${config.name} 定时触发`,
          description: `Agent ${config.name} 的 QQ 定时触发（每 ${schedule.intervalSeconds}s）`,
          source: 'cron',
          priority: 0,
          rule: { type: 'interval', value: schedule.intervalSeconds },
          action,
          cooldownSeconds: 0,
          enabled: true,
          targetAgentId: agentId,
        },
        {
          triggerId,
          scheduleType: 'interval',
          intervalSeconds: schedule.intervalSeconds,
        },
      )
    }
  }
}

/**
 * 删除 Agent 对应的定时触发器
 */
async function removeAgentTrigger(agentId: string): Promise<void> {
  let triggerModule: import('../trigger/index').TriggerModule
  try {
    const { getTriggerModule } = await import('../trigger/index')
    triggerModule = getTriggerModule()
  } catch {
    // TriggerModule 未就绪，忽略
    return
  }

  const triggerId = `agent-schedule-${agentId}`
  const existing = triggerModule.getTrigger(triggerId)
  if (existing) {
    triggerModule.deleteTrigger(triggerId)
  }
}
