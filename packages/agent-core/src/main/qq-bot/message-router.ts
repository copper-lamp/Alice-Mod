/**
 * V24 QQ 消息路由模块 — 将 OneBot 接收到的 QQ 消息路由到绑定的 Agent 实例
 *
 * 职责：
 * 1. 根据 QQ 账号 ID 查找绑定了该账号的 Agent 配置
 * 2. 通过 MainAgentRegistry 获取 MainAgent 实例（若未预热则异步构造）
 * 3. 若 Agent 为 QQAgent 子类，调用 handleQQMessage()；否则调用 handle() 基本处理
 * 4. 将 Agent 回复通过 OneBotClient 发送回 QQ
 *
 * 设计说明：
 * - 本模块不持有 MainAgentRegistry 引用，通过 getMainAgentRegistry() 获取共享单例
 * - 使用懒加载 (import) 避免循环依赖（ipc/index.ts 导入 qq-bot-handler.ts，而
 *   qq-bot-handler.ts 需导入 getMainAgentRegistry）
 * - AgentConfigManager 同理通过懒加载获取
 */

import type { QQMessage } from './types'
import type { OneBotClient } from './onebot-client'
import type { AgentConfig } from '../../renderer/src/lib/types'

/**
 * 路由一条 QQ 消息到绑定的 Agent 实例
 *
 * @param accountId 发送消息的 QQ 账号 ID（对应 QQAccount.id）
 * @param msg       QQ 消息对象
 * @param client    OneBot 客户端实例（用于发送回复）
 * @returns 是否成功路由
 */
export async function routeQQMessageToAgent(
  accountId: string,
  msg: QQMessage,
  client: OneBotClient,
): Promise<boolean> {
  // 1. 懒加载避免循环依赖
  const { getMainAgentRegistry } = await import('../ipc/index')
  const { getSharedAgentConfigManager } = await import('../ipc/agent-handler')

  const registry = getMainAgentRegistry()
  const agentConfigManager = getSharedAgentConfigManager()

  // 2. 查找绑定了该 QQ 账号的 Agent
  const boundAgent = await findBoundAgent(agentConfigManager, accountId)
  if (!boundAgent) {
    console.log(`[MessageRouter] 账号 ${accountId} 未绑定任何 Agent，消息已记录但不处理`)
    return false
  }

  // 3. 获取完整配置
  const config = await agentConfigManager.get(boundAgent.id)
  if (!config?.qqBinding?.enabled) {
    console.log(`[MessageRouter] Agent ${boundAgent.id} 未启用 QQ 绑定，跳过`)
    return false
  }

  // 4. 群组过滤
  if (msg.type === 'group' && msg.groupId) {
    const boundGroups = config.qqBinding.groupIds ?? []
    if (boundGroups.length > 0 && !boundGroups.includes(msg.groupId)) {
      return false // 不在监听群组列表中，忽略
    }
  }

  // 5. V27: mentionOnly 模式过滤 — 仅处理 @ 机器人的消息
  if (config.qqBinding.mentionOnly && !isAtBot(msg)) {
    return false
  }

  // 5. 获取 MainAgent 实例
  const workspaceId = config.workspaceId ?? ''
  const agent = await registry.get(workspaceId, boundAgent.id)
  if (!agent) {
    console.warn(`[MessageRouter] Agent ${boundAgent.id} 未就绪`)
    return false
  }

  // 6. 处理消息
  try {
    let response: string

    // 6a. 检查是否为 QQAgent（支持 handleQQMessage）
    if (typeof (agent as any).handleQQMessage === 'function') {
      const result = await (agent as any).handleQQMessage(msg)
      response = result.response ?? ''
    } else {
      // 6b. 普通 MainAgent，使用 handle() 基本处理
      const prompt = formatQQPrompt(msg)
      const result = await agent.handle({ source: 'qq', prompt })
      response = result.finalResponse
    }

    // 7. 发送回复
    if (response) {
      const target = msg.groupId ?? msg.userId
      const messageType = msg.type === 'group' ? 'sendGroupMsg' : 'sendPrivateMsg'
      try {
        if (msg.type === 'group') {
          await client.sendGroupMsg(target, response)
        } else {
          await client.sendPrivateMsg(target, response)
        }
        console.log(`[MessageRouter] 回复已发送到 ${messageType === 'sendGroupMsg' ? '群' : '私聊'} ${target}`)
      } catch (err) {
        console.error(`[MessageRouter] 发送回复失败:`, err)
      }
    }

    return true
  } catch (err) {
    console.error(`[MessageRouter] Agent 处理 QQ 消息失败:`, err)
    return false
  }
}

/**
 * 查找绑定了指定 QQ 账号的 Agent 配置
 * 遍历 AgentConfigManager 缓存，找到 qqBinding.accountId 匹配的 Agent
 */
async function findBoundAgent(
  configManager: ReturnType<typeof import('../ipc/agent-handler')['getSharedAgentConfigManager']>,
  accountId: string,
): Promise<{ id: string } | null> {
  try {
    const agents = await configManager.list()
    // 逐个检查完整配置（list 返回摘要，需要 get 获取完整配置含 qqBinding）
    for (const summary of agents) {
      const config = await configManager.get(summary.id)
      if (config?.qqBinding?.enabled && config.qqBinding.accountId === accountId) {
        return { id: summary.id }
      }
    }
  } catch (err) {
    console.warn(`[MessageRouter] 查找绑定 Agent 失败:`, err)
  }
  return null
}

/**
 * 检查消息是否 @ 了机器人
 * 检测消息段中是否有 type='at' 的段
 */
function isAtBot(msg: QQMessage): boolean {
  return msg.segments?.some(
    seg => seg.type === 'at' && seg.data?.qq === 'all',
  ) ?? false
}

/**
 * 格式化 QQ 消息为普通 prompt（当 Agent 不是 QQAgent 时使用）
 */
function formatQQPrompt(msg: QQMessage): string {
  const parts: string[] = []
  if (msg.groupId) {
    parts.push(`[群消息] 来自群 ${msg.groupId}，用户 ${msg.userId}（${msg.userName}）：${msg.content}`)
  } else {
    parts.push(`[私聊] 来自用户 ${msg.userId}（${msg.userName}）：${msg.content}`)
  }
  return parts.join('\n')
}