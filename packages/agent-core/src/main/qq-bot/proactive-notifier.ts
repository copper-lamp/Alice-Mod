/**
 * ProactiveNotifier — QQ 主动通知器
 *
 * 订阅游戏内重要事件，主动推送到指定 QQ 群。
 * 支持通知模板和合并窗口（5s 内同类事件合并）。
 */

import type { AgentEvent, IEventBus } from '../trigger/types';
import type { OneBotClient } from './onebot-client';

export interface NotificationRule {
  /** 事件类型，如 player_died / task_completed */
  eventType: string;
  /** 目标群号列表 */
  groupIds: string[];
  /** 消息模板，支持 {{event.payload.xxx}} 占位符 */
  template: string;
  /** 是否启用 */
  enabled?: boolean;
  /** 合并窗口（毫秒），默认 5000 */
  mergeWindowMs?: number;
}

export interface ProactiveNotifierDeps {
  eventBus: IEventBus | null;
  client: OneBotClient;
  rules?: NotificationRule[];
}

export class ProactiveNotifier {
  private eventBus: IEventBus | null = null;
  private client: OneBotClient;
  private rules: NotificationRule[];
  private unsubscribe: (() => void) | null = null;
  // 合并窗口：eventType -> { timestamp, content }
  private mergeBuffer = new Map<string, { timestamp: number; contents: string[] }>();

  constructor(deps: ProactiveNotifierDeps) {
    this.eventBus = deps.eventBus ?? null;
    this.client = deps.client;
    this.rules = deps.rules ?? [];
  }

  /** 启动通知器 */
  start(): void {
    if (this.unsubscribe) return;
    if (!this.eventBus) return;

    this.unsubscribe = this.eventBus.subscribe({}, (event) => {
      this.handleEvent(event);
    });
  }

  /** 动态绑定事件总线（支持延迟初始化） */
  bindEventBus(eventBus: IEventBus): void {
    this.eventBus = eventBus;
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    this.start();
  }

  /** 停止通知器 */
  stop(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    this.mergeBuffer.clear();
  }

  /** 更新通知规则 */
  setRules(rules: NotificationRule[]): void {
    this.rules = rules;
  }

  /** 添加通知规则 */
  addRule(rule: NotificationRule): void {
    const idx = this.rules.findIndex(r => r.eventType === rule.eventType);
    if (idx >= 0) {
      this.rules[idx] = rule;
    } else {
      this.rules.push(rule);
    }
  }

  /** 移除通知规则 */
  removeRule(eventType: string): void {
    this.rules = this.rules.filter(r => r.eventType !== eventType);
  }

  private handleEvent(event: AgentEvent): void {
    const rule = this.rules.find(
      r => r.eventType === event.type && (r.enabled !== false),
    );
    if (!rule || rule.groupIds.length === 0) return;

    const content = this.renderTemplate(rule.template, event);
    if (!content.trim()) return;

    const mergeWindow = rule.mergeWindowMs ?? 5000;
    const buffered = this.mergeBuffer.get(event.type);
    const now = Date.now();

    if (buffered && now - buffered.timestamp < mergeWindow) {
      buffered.contents.push(content);
      return;
    }

    // 发送上一批合并内容
    if (buffered && buffered.contents.length > 0) {
      this.sendToGroups(rule.groupIds, buffered.contents.join('\n'));
    }

    // 开始新窗口
    this.mergeBuffer.set(event.type, { timestamp: now, contents: [content] });

    // 窗口结束后发送
    setTimeout(() => {
      const current = this.mergeBuffer.get(event.type);
      if (current && current.timestamp === now && current.contents.length > 0) {
        this.sendToGroups(rule.groupIds, current.contents.join('\n'));
        this.mergeBuffer.delete(event.type);
      }
    }, mergeWindow);
  }

  private async sendToGroups(groupIds: string[], content: string): Promise<void> {
    for (const groupId of groupIds) {
      try {
        await this.client.sendGroupMsg(groupId, content);
      } catch (err) {
        console.error(`[ProactiveNotifier] 发送通知到群 ${groupId} 失败:`, err);
      }
    }
  }

  /** 渲染模板 */
  private renderTemplate(template: string, event: AgentEvent): string {
    return template.replace(/\{\{(.*?)\}\}/g, (_, path: string) => {
      const value = this.getValueByPath({ event }, path.trim());
      return value !== undefined ? String(value) : '';
    });
  }

  private getValueByPath(obj: Record<string, unknown>, path: string): unknown {
    const parts = path.split('.');
    let current: unknown = obj;
    for (const part of parts) {
      if (current === null || current === undefined) return undefined;
      if (typeof current !== 'object') return undefined;
      current = (current as Record<string, unknown>)[part];
    }
    return current;
  }
}
