/**
 * GameChatTriggerAdapter — 游戏聊天触发器适配器
 *
 * 将 Adapter Core 推送的游戏聊天事件转换为 AgentEvent。
 */

import type { AgentEvent, TriggerSource, TriggerAdapter, GameChatPayload } from '../types';
import { generateEventId } from '../action-executor';

export class GameChatTriggerAdapter implements TriggerAdapter {
  readonly source: TriggerSource = 'game_chat';

  async start(): Promise<void> {
    // 无需启动操作
  }

  async stop(): Promise<void> {
    // 无需清理操作
  }

  handle(rawEvent: unknown): AgentEvent | null {
    const payload = rawEvent as Partial<GameChatPayload>;

    if (!payload.workspaceId || !payload.playerId || typeof payload.message !== 'string') {
      return null;
    }

    return {
      id: generateEventId(),
      type: 'game_chat',
      source: 'game_chat',
      workspaceId: payload.workspaceId,
      timestamp: payload.timestamp ?? Date.now(),
      payload: {
        playerId: payload.playerId,
        playerName: payload.playerName ?? payload.playerId,
        message: payload.message,
        rawMessage: payload.rawMessage ?? payload.message,
        isAtBot: payload.isAtBot ?? false,
      },
    };
  }
}
