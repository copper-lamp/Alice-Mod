/**
 * TriggerModule — 事件触发器模块入口
 *
 * 组装 EventBus、TriggerStore、TriggerEngine、ActionExecutor 和各类 Adapter，
 * 对外提供统一的触发器管理、事件发布和生命周期控制。
 */

import type Database from 'better-sqlite3';
import { EventBus } from './event-bus';
import { TriggerStore } from './trigger-store';
import { TriggerEngine } from './trigger-engine';
import { ActionExecutor } from './action-executor';
import {
  CronTriggerAdapter,
  GameChatTriggerAdapter,
  PluginEventTriggerAdapter,
  QQTriggerAdapter,
  RandomWindowTriggerAdapter,
} from './adapters';
import type {
  AgentEvent,
  EventTrigger,
  CreateTriggerParams,
  UpdateTriggerParams,
  ListTriggerOptions,
  TriggerSource,
  ActionExecutorDeps,
  TriggerSchedule,
  TriggerAdapter,
} from './types';

export interface TriggerModuleConfig {
  defaultCooldownSeconds?: number;
  maxLogsPerTrigger?: number;
  logRetentionDays?: number;
  cronTimezone?: string;
}

export interface TriggerModuleDeps {
  db: Database.Database;
  actionDeps: ActionExecutorDeps;
  logger?: {
    info: (msg: string) => void;
    warn: (msg: string, meta?: Record<string, unknown>) => void;
    error: (msg: string, meta?: Record<string, unknown>) => void;
  };
}

export class TriggerModule {
  private eventBus: EventBus;
  private store: TriggerStore;
  private actionExecutor: ActionExecutor;
  private engine: TriggerEngine;
  private logger?: TriggerModuleDeps['logger'];
  private adapters: {
    cron: CronTriggerAdapter;
    gameChat: GameChatTriggerAdapter;
    pluginEvent: PluginEventTriggerAdapter;
    qq: QQTriggerAdapter;
    randomWindow: RandomWindowTriggerAdapter;
  };
  private running = false;

  constructor(deps: TriggerModuleDeps, config: TriggerModuleConfig = {}) {
    this.eventBus = new EventBus();
    this.store = new TriggerStore(deps.db);
    this.actionExecutor = new ActionExecutor(deps.actionDeps);
    this.logger = deps.logger;
    this.engine = new TriggerEngine(
      {
        eventBus: this.eventBus,
        store: this.store,
        actionExecutor: this.actionExecutor,
        logger: deps.logger,
      },
      {
        defaultCooldownSeconds: config.defaultCooldownSeconds,
        maxLogsPerTrigger: config.maxLogsPerTrigger,
        logRetentionDays: config.logRetentionDays,
      },
    );

    this.adapters = {
      cron: new CronTriggerAdapter(this.eventBus, this.store, { timezone: config.cronTimezone }),
      gameChat: new GameChatTriggerAdapter(),
      pluginEvent: new PluginEventTriggerAdapter(),
      qq: new QQTriggerAdapter(),
      randomWindow: new RandomWindowTriggerAdapter(this.eventBus, this.store),
    };
  }

  /** 启动触发器模块 */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    this.engine.start();

    for (const adapter of Object.values(this.adapters)) {
      await adapter.start();
    }

    this.log('info', 'TriggerModule 已启动');
  }

  /** 停止触发器模块 */
  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;

    this.engine.stop();

    for (const adapter of Object.values(this.adapters)) {
      await adapter.stop();
    }

    this.log('info', 'TriggerModule 已停止');
  }

  /** 发布事件到事件总线 */
  publishEvent(event: AgentEvent): void {
    this.eventBus.publish(event);
  }

  /** 通过适配器处理原始事件并发布 */
  handleRawEvent(source: TriggerSource, rawEvent: unknown): void {
    const adapter = this.getAdapter(source);
    if (!adapter) return;

    const event = adapter.handle(rawEvent);
    if (event) {
      this.eventBus.publish(event);
    }
  }

  private getAdapter(source: TriggerSource): TriggerAdapter | undefined {
    switch (source) {
      case 'cron':
        return this.adapters.cron;
      case 'game_chat':
        return this.adapters.gameChat;
      case 'plugin_event':
        return this.adapters.pluginEvent;
      case 'qq':
        return this.adapters.qq;
      default:
        return undefined;
    }
  }

  /** 创建触发器 */
  createTrigger(params: CreateTriggerParams, schedule?: TriggerSchedule): EventTrigger {
    const trigger = this.store.create(params, schedule);

    // 如果已启动，立即调度
    if (this.running && schedule) {
      if (this.isRandomWindowSchedule(schedule)) {
        this.adapters.randomWindow.schedule(trigger.id, schedule);
      } else if (trigger.source === 'cron') {
        this.adapters.cron.schedule(trigger.id, schedule);
      }
    }

    return trigger;
  }

  /** 更新触发器 */
  updateTrigger(id: string, params: UpdateTriggerParams): EventTrigger | null {
    const trigger = this.store.update(id, params);

    // 如果已启动，重新调度
    if (this.running && trigger) {
      const schedule = this.store.getSchedule(trigger.id);
      if (schedule) {
        if (this.isRandomWindowSchedule(schedule)) {
          this.adapters.randomWindow.schedule(trigger.id, schedule);
        } else if (trigger.source === 'cron') {
          this.adapters.cron.schedule(trigger.id, schedule);
        }
      } else {
        this.adapters.cron.unschedule(trigger.id);
        this.adapters.randomWindow.unschedule(trigger.id);
      }
    }

    return trigger;
  }

  /** 删除触发器 */
  deleteTrigger(id: string): boolean {
    const trigger = this.store.getById(id);
    if (trigger) {
      this.adapters.cron.unschedule(id);
      this.adapters.randomWindow.unschedule(id);
    }
    return this.store.delete(id);
  }

  /** 判断调度是否为随机窗口调度 */
  private isRandomWindowSchedule(schedule: TriggerSchedule): boolean {
    if (!schedule.cronExpression) return false;
    try {
      const parsed = JSON.parse(schedule.cronExpression);
      return parsed?.type === 'random_window';
    } catch {
      return false;
    }
  }

  /** 获取触发器 */
  getTrigger(id: string): EventTrigger | null {
    return this.store.getById(id);
  }

  /** 列出触发器 */
  listTriggers(options?: ListTriggerOptions): EventTrigger[] {
    return this.store.list(options);
  }

  /** 获取触发器日志 */
  getTriggerLogs(triggerId: string, limit?: number): Array<{
    id: number;
    triggerId: string;
    eventType: string;
    eventPayload?: Record<string, unknown>;
    action: import('./types').TriggerAction;
    success: boolean;
    error?: string;
    triggeredAt: number;
  }> {
    return this.store.getLogs(triggerId, limit);
  }

  /** 获取内部 EventBus（供高级场景直接订阅） */
  getEventBus(): EventBus {
    return this.eventBus;
  }

  /** 获取内部 Engine（供测试使用） */
  getEngine(): TriggerEngine {
    return this.engine;
  }

  /** 获取内部 Store（供测试使用） */
  getStore(): TriggerStore {
    return this.store;
  }

  /** 手动注册一个内存触发器（不持久化） */
  registerTransient(trigger: EventTrigger): void {
    this.engine.register(trigger);
  }

  private log(level: 'info' | 'warn' | 'error', msg: string, err?: unknown): void {
    if (!this.logger) return;
    const meta = err ? { error: err instanceof Error ? err.message : String(err) } : undefined;
    if (level === 'info') this.logger.info(msg);
    if (level === 'warn') this.logger.warn(msg, meta);
    if (level === 'error') this.logger.error(msg, meta);
  }
}

// 单例引用
let triggerModuleInstance: TriggerModule | null = null;

export function setTriggerModule(instance: TriggerModule): void {
  triggerModuleInstance = instance;
}

export function getTriggerModule(): TriggerModule {
  if (!triggerModuleInstance) {
    throw new Error('TriggerModule 尚未初始化');
  }
  return triggerModuleInstance;
}

export * from './types';
export { EventBus } from './event-bus';
export { TriggerStore } from './trigger-store';
export { TriggerEngine } from './trigger-engine';
export { ActionExecutor } from './action-executor';
export * from './adapters';
