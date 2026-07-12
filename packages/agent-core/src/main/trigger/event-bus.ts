/**
 * EventBus — 事件总线
 *
 * 统一事件发布/订阅，支持按类型、来源、工作区过滤。
 * 所有事件异步分发，不阻塞发布方。
 */

import type { AgentEvent, EventFilter, EventHandler, IEventBus, EventSource } from './types';

export class EventBus implements IEventBus {
  private handlers: Array<{ filter: EventFilter; handler: EventHandler }> = [];
  private typeHandlers = new Map<string, Set<EventHandler>>();

  publish(event: AgentEvent): void {
    // 异步分发，避免阻塞发布方
    setImmediate(() => {
      // 1. 按过滤条件订阅的处理器
      for (const { filter, handler } of this.handlers) {
        if (this.matchesFilter(event, filter)) {
          this.safeHandle(handler, event);
        }
      }

      // 2. 按事件类型订阅的处理器
      const typeHandlers = this.typeHandlers.get(event.type);
      if (typeHandlers) {
        for (const handler of typeHandlers) {
          this.safeHandle(handler, event);
        }
      }
    });
  }

  subscribe(filter: EventFilter, handler: EventHandler): () => void {
    const entry = { filter, handler };
    this.handlers.push(entry);
    return () => {
      const idx = this.handlers.indexOf(entry);
      if (idx >= 0) this.handlers.splice(idx, 1);
    };
  }

  on(eventType: string, handler: EventHandler): () => void {
    if (!this.typeHandlers.has(eventType)) {
      this.typeHandlers.set(eventType, new Set());
    }
    this.typeHandlers.get(eventType)!.add(handler);

    return () => {
      this.typeHandlers.get(eventType)?.delete(handler);
    };
  }

  clear(): void {
    this.handlers = [];
    this.typeHandlers.clear();
  }

  private safeHandle(handler: EventHandler, event: AgentEvent): void {
    try {
      const result = handler(event);
      if (result && typeof result.then === 'function') {
        result.catch(err => {
          console.error('[EventBus] 事件处理器异常:', err instanceof Error ? err.message : String(err));
        });
      }
    } catch (err) {
      console.error('[EventBus] 事件处理器异常:', err instanceof Error ? err.message : String(err));
    }
  }

  private matchesFilter(event: AgentEvent, filter: EventFilter): boolean {
    if (filter.type && event.type !== filter.type) return false;
    if (filter.source && event.source !== filter.source) return false;
    if (filter.workspaceId !== undefined && event.workspaceId !== filter.workspaceId) return false;
    return true;
  }
}
