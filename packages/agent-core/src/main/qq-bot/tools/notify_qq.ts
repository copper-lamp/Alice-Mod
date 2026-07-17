/**
 * notify_qq — 主 Agent 通知 QQ 群工具
 *
 * V27: 供主 Agent 的 LLM 调用，主动向绑定的 QQ 群发送通知消息。
 * 工具注册在 workspace 的 ToolRegistry 中，通过 Pipeline 中间件处理本地执行。
 *
 * 数据流：
 *   MainAgent LLM → notify_qq → Pipeline 中间件拦截
 *   → MainAgentRegistry 查找 QQAgent → QQAgent.sendQQMessage()
 *   → OneBotClient.sendGroupMsg()
 */

import type { ToolSchema, ParamDefinition } from '@mcagent/shared';
import { ToolCategory } from '@mcagent/shared';

/** notify_qq 工具参数 */
export interface NotifyQQParams {
  /** 通知内容（纯文本） */
  content: string
  /** 目标群号或 QQ 号（可选，默认发送到绑定的 QQ 群） */
  target?: string
}

/** notify_qq 工具返回 */
export interface NotifyQQResult {
  success: boolean
  message?: string
  error?: string
}

/**
 * notify_qq 工具定义
 * 注册到 workspace 的 ToolRegistry，供 LLM 可见。
 */
export const NOTIFY_QQ_TOOL_SCHEMA: ToolSchema = {
  name: 'notify_qq',
  description: '向绑定的 QQ 群发送通知消息。当需要主动向 QQ 用户汇报进展、发送提醒或通知时使用。',
  category: ToolCategory.QQ,
  parameters: {
    content: {
      type: 'string',
      description: '通知内容（纯文本消息）',
      required: true,
    } as ParamDefinition,
    target: {
      type: 'string',
      description: '目标群号或 QQ 号（可选，默认发送到第一个绑定的 QQ 群）',
      required: false,
    } as ParamDefinition,
  },
}