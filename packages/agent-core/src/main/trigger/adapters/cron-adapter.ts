/**
 * CronTriggerAdapter — 定时触发器适配器
 *
 * 支持三种调度方式：
 * - cron: 标准 Cron 表达式
 * - at: 绝对时间（一次性）
 * - interval: 固定间隔（循环）
 *
 * 依赖 node-cron 解析和执行 Cron 表达式。
 */

import * as cron from 'node-cron';
import type { AgentEvent, TriggerSource, TriggerAdapter, IEventBus, TriggerSchedule } from '../types';
import type { TriggerStore } from '../trigger-store';
import { generateEventId } from '../action-executor';

export interface CronAdapterConfig {
  /** 时区，默认系统时区 */
  timezone?: string;
  /** 重启后最大 missed 补偿次数 */
  maxMissedCompensation?: number;
}

export class CronTriggerAdapter implements TriggerAdapter {
  readonly source: TriggerSource = 'cron';

  private eventBus: IEventBus;
  private store: TriggerStore;
  private config: Required<CronAdapterConfig>;
  private cronJobs: Map<string, cron.ScheduledTask> = new Map();
  private timeouts: Map<string, NodeJS.Timeout> = new Map();
  private intervals: Map<string, NodeJS.Timeout> = new Map();
  private running = false;

  constructor(eventBus: IEventBus, store: TriggerStore, config: CronAdapterConfig = {}) {
    this.eventBus = eventBus;
    this.store = store;
    this.config = {
      timezone: config.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
      maxMissedCompensation: config.maxMissedCompensation ?? 10,
    };
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    const triggers = this.store.list({ source: 'cron', enabled: true });
    for (const trigger of triggers) {
      const schedule = this.store.getSchedule(trigger.id);
      if (schedule) {
        this.schedule(trigger.id, schedule);
      }
    }

    // missed 触发补偿
    this.compensateMissedTriggers(triggers.map(t => t.id));
  }

  async stop(): Promise<void> {
    this.running = false;

    for (const job of this.cronJobs.values()) {
      job.stop();
    }
    this.cronJobs.clear();

    for (const timer of this.timeouts.values()) {
      clearTimeout(timer);
    }
    this.timeouts.clear();

    for (const interval of this.intervals.values()) {
      clearInterval(interval);
    }
    this.intervals.clear();
  }

  handle(_rawEvent: unknown): AgentEvent | null {
    // Cron 事件由适配器内部生成，不需要外部 handle
    return null;
  }

  /** 为指定触发器调度 */
  schedule(triggerId: string, schedule: TriggerSchedule): void {
    this.unschedule(triggerId);

    switch (schedule.scheduleType) {
      case 'cron':
        if (schedule.cronExpression && cron.validate(schedule.cronExpression)) {
          const job = cron.schedule(
            schedule.cronExpression,
            () => this.fire(triggerId, schedule.cronExpression!),
            { timezone: this.config.timezone },
          );
          this.cronJobs.set(triggerId, job);
        }
        break;

      case 'at':
        if (schedule.scheduledAt) {
          const delay = schedule.scheduledAt - Date.now();
          if (delay > 0) {
            const timer = setTimeout(() => {
              this.fire(triggerId, `at:${schedule.scheduledAt}`);
              this.unschedule(triggerId);
            }, delay);
            this.timeouts.set(triggerId, timer);
          }
        }
        break;

      case 'interval':
        if (schedule.intervalSeconds && schedule.intervalSeconds > 0) {
          const ms = schedule.intervalSeconds * 1000;
          const interval = setInterval(() => this.fire(triggerId, `interval:${schedule.intervalSeconds}s`), ms);
          this.intervals.set(triggerId, interval);
        }
        break;
    }
  }

  /** 取消指定触发器的调度 */
  unschedule(triggerId: string): void {
    const cronJob = this.cronJobs.get(triggerId);
    if (cronJob) {
      cronJob.stop();
      this.cronJobs.delete(triggerId);
    }

    const timeout = this.timeouts.get(triggerId);
    if (timeout) {
      clearTimeout(timeout);
      this.timeouts.delete(triggerId);
    }

    const interval = this.intervals.get(triggerId);
    if (interval) {
      clearInterval(interval);
      this.intervals.delete(triggerId);
    }
  }

  /** 触发 cron 事件 */
  private fire(triggerId: string, scheduleInfo: string): void {
    const trigger = this.store.getById(triggerId);
    if (!trigger || !trigger.enabled) return;

    this.store.saveSchedule({
      triggerId,
      scheduleType: 'cron',
      cronExpression: trigger.rule.type === 'cron' ? String(trigger.rule.value ?? '') : undefined,
      lastScheduledAt: Date.now(),
    });

    const event: AgentEvent = {
      id: generateEventId(),
      type: 'cron_trigger',
      source: 'cron',
      workspaceId: trigger.workspaceId,
      timestamp: Date.now(),
      payload: {
        triggerId,
        scheduleInfo,
        triggerName: trigger.name,
      },
    };

    this.eventBus.publish(event);
  }

  /** 补偿错过的触发（仅对 missed 的 at 类型触发器） */
  private compensateMissedTriggers(triggerIds: string[]): void {
    const now = Date.now();
    let compensated = 0;

    for (const triggerId of triggerIds) {
      if (compensated >= this.config.maxMissedCompensation) break;

      const schedule = this.store.getSchedule(triggerId);
      if (!schedule) continue;

      // 仅对 at 类型的过期触发器进行一次性补偿
      if (schedule.scheduleType === 'at' && schedule.scheduledAt && schedule.scheduledAt < now) {
        // 检查是否已触发过
        if (!schedule.lastScheduledAt) {
          this.fire(triggerId, `missed_at:${schedule.scheduledAt}`);
          compensated++;
        }
      }
    }
  }
}
