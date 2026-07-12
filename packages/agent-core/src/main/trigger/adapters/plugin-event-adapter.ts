/**
 * PluginEventTriggerAdapter — 插件事件触发器适配器
 *
 * 将 Adapter Core 推送的插件事件转换为 AgentEvent。
 */

import type { AgentEvent, TriggerSource, TriggerAdapter, PluginEventPayload } from '../types';
import { generateEventId } from '../action-executor';

export class PluginEventTriggerAdapter implements TriggerAdapter {
  readonly source: TriggerSource = 'plugin_event';

  async start(): Promise<void> {
    // 无需启动操作
  }

  async stop(): Promise<void> {
    // 无需清理操作
  }

  handle(rawEvent: unknown): AgentEvent | null {
    const payload = rawEvent as Partial<PluginEventPayload>;

    if (!payload.workspaceId || !payload.eventType) {
      return null;
    }

    return {
      id: generateEventId(),
      type: payload.eventType,
      source: 'plugin_event',
      workspaceId: payload.workspaceId,
      timestamp: Date.now(),
      payload: {
        eventType: payload.eventType,
        entityId: payload.entityId,
        position: payload.position,
        data: payload.data ?? {},
      },
    };
  }
}
