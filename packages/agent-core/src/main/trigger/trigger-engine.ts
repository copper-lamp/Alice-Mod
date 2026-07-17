/**
 * TriggerEngine — 触发器规则引擎
 *
 * 负责：
 * 1. 从 TriggerStore 加载触发器
 * 2. 订阅 EventBus 事件
 * 3. 评估事件与触发器规则
 * 4. 处理冷却、最大触发次数、优先级
 * 5. 调用 ActionExecutor 执行动作
 * 6. 记录触发器日志
 */

import type { IEventBus, AgentEvent, EventTrigger, TriggerRule, TriggerMatch, ActionResult } from './types';
import type { TriggerStore } from './trigger-store';
import type { ActionExecutor } from './action-executor';

export interface TriggerEngineConfig {
  /** 默认冷却时间（秒） */
  defaultCooldownSeconds?: number;
  /** 最大日志保留数（每个触发器） */
  maxLogsPerTrigger?: number;
  /** 日志保留天数 */
  logRetentionDays?: number;
}

export interface TriggerEngineDeps {
  eventBus: IEventBus;
  store: TriggerStore;
  actionExecutor: ActionExecutor;
  logger?: {
    info: (msg: string) => void;
    warn: (msg: string, meta?: Record<string, unknown>) => void;
    error: (msg: string, meta?: Record<string, unknown>) => void;
  };
}

export class TriggerEngine {
  private eventBus: IEventBus;
  private store: TriggerStore;
  private actionExecutor: ActionExecutor;
  private config: Required<TriggerEngineConfig>;
  private logger: NonNullable<TriggerEngineDeps['logger']>;
  private running = false;
  private unsubscribe: (() => void) | null = null;

  // 内存冷却状态：triggerId -> 最后触发时间
  private cooldownMap = new Map<string, number>();
  // 内存去重：source + eventId -> timestamp（插件事件去重）
  private dedupMap = new Map<string, number>();

  constructor(deps: TriggerEngineDeps, config: TriggerEngineConfig = {}) {
    this.eventBus = deps.eventBus;
    this.store = deps.store;
    this.actionExecutor = deps.actionExecutor;
    this.config = {
      defaultCooldownSeconds: config.defaultCooldownSeconds ?? 5,
      maxLogsPerTrigger: config.maxLogsPerTrigger ?? 1000,
      logRetentionDays: config.logRetentionDays ?? 30,
    };
    this.logger = deps.logger ?? {
      info: (msg) => console.info(`[TriggerEngine] ${msg}`),
      warn: (msg, err) => console.warn(`[TriggerEngine] ${msg}`, err),
      error: (msg, err) => console.error(`[TriggerEngine] ${msg}`, err),
    };
  }

  /** 启动引擎，订阅所有事件 */
  start(): void {
    if (this.running) return;
    this.running = true;

    this.unsubscribe = this.eventBus.subscribe({}, (event) => {
      this.handleEvent(event);
    });

    this.logger.info('TriggerEngine 已启动');
  }

  /** 停止引擎 */
  stop(): void {
    this.running = false;
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    this.cooldownMap.clear();
    this.dedupMap.clear();
    this.logger.info('TriggerEngine 已停止');
  }

  /** 注册并持久化新触发器 */
  register(trigger: EventTrigger): void {
    // 已存在则更新，不存在则创建
    const existing = this.store.getById(trigger.id);
    if (existing) {
      this.store.update(trigger.id, trigger);
    } else {
      this.store.create({
        workspaceId: trigger.workspaceId,
        name: trigger.name,
        description: trigger.description,
        source: trigger.source,
        priority: trigger.priority,
        rule: trigger.rule,
        action: trigger.action,
        cooldownSeconds: trigger.cooldownSeconds,
        maxTriggerCount: trigger.maxTriggerCount,
        enabled: trigger.enabled,
      });
    }
  }

  /** 注销触发器 */
  unregister(triggerId: string): boolean {
    return this.store.delete(triggerId);
  }

  /** 从数据库重新加载所有触发器 */
  loadFromStore(): EventTrigger[] {
    return this.store.list();
  }

  /** 获取所有触发器 */
  list(options?: { workspaceId?: string; source?: EventTrigger['source']; enabled?: boolean }): EventTrigger[] {
    return this.store.list(options);
  }

  /** 处理单个事件 */
  private async handleEvent(event: AgentEvent): Promise<void> {
    if (!this.running) return;

    // 插件事件去重
    if (event.source === 'plugin_event' && this.isDuplicate(event)) {
      return;
    }

    const triggers = this.store.list({ enabled: true });
    const matches = this.evaluate(event, triggers);

    for (const match of matches) {
      await this.executeTrigger(match);
    }
  }

  /**
   * 评估事件与触发器列表
   * 返回按优先级排序的匹配结果
   */
  evaluate(event: AgentEvent, triggers?: EventTrigger[]): TriggerMatch[] {
    const list = triggers ?? this.store.list({ enabled: true });
    const matches: TriggerMatch[] = [];

    for (const trigger of list) {
      // 工作区过滤：空 workspaceId 表示全局，否则必须匹配
      if (trigger.workspaceId && trigger.workspaceId !== event.workspaceId) {
        continue;
      }
      // 来源过滤：触发器 source 必须与事件 source 一致（系统事件除外）
      if (trigger.source !== event.source && event.source !== 'system') {
        continue;
      }

      const matchedRule = this.matchRule(trigger.rule, event);
      if (matchedRule) {
        matches.push({ trigger, event, matchedRule });
      }
    }

    // 按优先级降序排序
    matches.sort((a, b) => b.trigger.priority - a.trigger.priority);
    return matches;
  }

  /** 执行命中的触发器 */
  private async executeTrigger(match: TriggerMatch): Promise<void> {
    const { trigger, event } = match;

    // 冷却检查
    if (this.isCoolingDown(trigger)) {
      return;
    }

    // 最大触发次数检查
    if (trigger.maxTriggerCount !== undefined && trigger.triggerCount >= trigger.maxTriggerCount) {
      return;
    }

    // 更新触发计数和冷却
    this.store.incrementTriggerCount(trigger.id);
    this.cooldownMap.set(trigger.id, Date.now());

    const triggeredAt = Date.now();
    let result: ActionResult;

    try {
      result = await this.actionExecutor.execute(trigger.action, event, trigger);
    } catch (err) {
      result = {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    // 记录日志
    this.store.logExecution({
      triggerId: trigger.id,
      eventType: event.type,
      eventPayload: event.payload,
      action: trigger.action,
      success: result.success,
      error: result.error,
      triggeredAt,
    });

    // 日志清理（按触发器）
    if (Math.random() < 0.01) {
      this.store.cleanupLogs(this.config.logRetentionDays, this.config.maxLogsPerTrigger);
    }

    if (!result.success) {
      this.logger.warn(`触发器 ${trigger.id} 执行失败: ${result.error}`);
    }
  }

  /** 规则匹配 */
  private matchRule(rule: TriggerRule, event: AgentEvent): TriggerRule | null {
    switch (rule.type) {
      case 'always':
        return rule;
      case 'keyword':
        return this.matchKeyword(rule.value, event) ? rule : null;
      case 'regex':
        return this.matchRegex(rule.value, event) ? rule : null;
      case 'event_type':
        return event.type === rule.value ? rule : null;
      case 'payload_field':
        return rule.field && this.matchPayloadField(rule.field, event) ? rule : null;
      case 'at_bot':
        return event.payload.isAtBot === true ? rule : null;
      case 'private_msg':
        return (event.payload.isPrivate === true || event.type === 'private') ? rule : null;
      case 'cron':
      case 'interval':
      case 'random_window':
        // Cron / Interval / RandomWindow 事件由对应 Adapter 处理，这里直接命中（事件已带 source=cron）
        return rule;
      case 'composite':
        return this.matchComposite(rule, event) ? rule : null;
      default:
        return null;
    }
  }

  private matchKeyword(value: unknown, event: AgentEvent): boolean {
    const keyword = String(value ?? '').toLowerCase();
    if (!keyword) return false;

    const text = this.getTextFromEvent(event).toLowerCase();
    return text.includes(keyword);
  }

  private matchRegex(value: unknown, event: AgentEvent): boolean {
    const pattern = String(value ?? '');
    if (!pattern) return false;

    try {
      const regex = new RegExp(pattern);
      return regex.test(this.getTextFromEvent(event));
    } catch {
      return false;
    }
  }

  private matchPayloadField(field: NonNullable<TriggerRule['field']>, event: AgentEvent): boolean {
    const actualValue = this.getValueByPath(event.payload, field.key);
    const expectedValue = field.value;

    switch (field.op) {
      case 'eq':
        return actualValue === expectedValue;
      case 'ne':
        return actualValue !== expectedValue;
      case 'gt':
        return typeof actualValue === 'number' && typeof expectedValue === 'number' && actualValue > expectedValue;
      case 'gte':
        return typeof actualValue === 'number' && typeof expectedValue === 'number' && actualValue >= expectedValue;
      case 'lt':
        return typeof actualValue === 'number' && typeof expectedValue === 'number' && actualValue < expectedValue;
      case 'lte':
        return typeof actualValue === 'number' && typeof expectedValue === 'number' && actualValue <= expectedValue;
      case 'contains':
        if (typeof actualValue === 'string' && typeof expectedValue === 'string') {
          return actualValue.includes(expectedValue);
        }
        if (Array.isArray(actualValue)) {
          return actualValue.includes(expectedValue);
        }
        return false;
      case 'starts_with':
        return typeof actualValue === 'string' && typeof expectedValue === 'string' && actualValue.startsWith(expectedValue);
      case 'ends_with':
        return typeof actualValue === 'string' && typeof expectedValue === 'string' && actualValue.endsWith(expectedValue);
      case 'in':
        return Array.isArray(expectedValue) && expectedValue.includes(actualValue);
      case 'not_in':
        return Array.isArray(expectedValue) && !expectedValue.includes(actualValue);
      default:
        return false;
    }
  }

  private matchComposite(rule: TriggerRule, event: AgentEvent): boolean {
    const conditions = rule.conditions ?? [];
    if (conditions.length === 0) return false;

    const operator = rule.operator ?? 'and';
    if (operator === 'and') {
      return conditions.every(r => this.matchRule(r, event) !== null);
    }
    return conditions.some(r => this.matchRule(r, event) !== null);
  }

  /** 从事件中提取文本（用于 keyword / regex） */
  private getTextFromEvent(event: AgentEvent): string {
    const payload = event.payload;
    if (typeof payload.message === 'string') return payload.message;
    if (typeof payload.content === 'string') return payload.content;
    if (typeof payload.rawMessage === 'string') return payload.rawMessage;
    if (typeof payload.rawContent === 'string') return payload.rawContent;
    return '';
  }

  /** 根据点号路径获取对象值 */
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

  /** 冷却检查 */
  private isCoolingDown(trigger: EventTrigger): boolean {
    const cooldownMs = (trigger.cooldownSeconds || this.config.defaultCooldownSeconds) * 1000;
    const lastTriggered = this.cooldownMap.get(trigger.id);
    if (!lastTriggered) return false;
    return Date.now() - lastTriggered < cooldownMs;
  }

  /** 插件事件去重检查（5 秒窗口） */
  private isDuplicate(event: AgentEvent): boolean {
    const dedupKey = `${event.source}:${event.type}:${JSON.stringify(event.payload)}`;
    const now = Date.now();
    const lastSeen = this.dedupMap.get(dedupKey);

    if (lastSeen && now - lastSeen < 5000) {
      return true;
    }

    this.dedupMap.set(dedupKey, now);

    // 清理过期去重记录
    if (this.dedupMap.size > 1000) {
      for (const [key, ts] of this.dedupMap) {
        if (now - ts > 5000) {
          this.dedupMap.delete(key);
        }
      }
    }

    return false;
  }
}
