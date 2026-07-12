/**
 * QQTriggerAdapter — QQ 渠道触发器适配器
 *
 * 将 QQ 消息转换为 AgentEvent。
 * 桥接消息应在外部过滤，不进入此适配器。
 */

import type { QQMessage } from '../../qq-bot/types';
import type { AgentEvent, TriggerSource, TriggerAdapter, QQEventPayload } from '../types';
import { generateEventId } from '../action-executor';

export class QQTriggerAdapter implements TriggerAdapter {
  readonly source: TriggerSource = 'qq';

  async start(): Promise<void> {
    // 无需启动操作
  }

  async stop(): Promise<void> {
    // 无需清理操作
  }

  handle(rawEvent: unknown): AgentEvent | null {
    const msg = rawEvent as Partial<QQMessage>;

    if (!msg.userId || typeof msg.content !== 'string') {
      return null;
    }

    const payload: QQEventPayload = {
      messageId: msg.id ?? generateEventId(),
      type: msg.type ?? 'private',
      groupId: msg.groupId,
      userId: msg.userId,
      userName: msg.userName ?? msg.userId,
      content: msg.content,
      rawContent: msg.rawContent ?? msg.content,
      isAtBot: this.isAtBot(msg),
      isPrivate: msg.type === 'private',
      timestamp: msg.timestamp ?? Date.now(),
    };

    const event: AgentEvent = {
      id: generateEventId(),
      type: this.resolveEventType(payload),
      source: 'qq',
      workspaceId: '', // QQ 不关联具体工作区
      timestamp: payload.timestamp,
      payload: payload as unknown as Record<string, unknown>,
    };

    return event;
  }

  /** 判断消息是否 @ 机器人 */
  private isAtBot(msg: Partial<QQMessage>): boolean {
    if (!msg.segments || !Array.isArray(msg.segments)) return false;

    return msg.segments.some(
      seg => seg.type === 'at' && seg.data && (seg.data.qq === 'all' || seg.data.qq === String(msg.userId)),
    );
  }

  /** 根据 QQ 消息类型确定事件类型 */
  private resolveEventType(payload: QQEventPayload): string {
    if (payload.isPrivate) return 'qq_private_msg';
    if (payload.isAtBot) return 'qq_at_bot';
    return 'qq_group_msg';
  }
}
