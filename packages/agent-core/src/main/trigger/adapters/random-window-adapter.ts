/**
 * RandomWindowTriggerAdapter — 随机时间段触发器适配器
 *
 * V27 新增：支持"某时间段内随机上线"的调度方式。
 *
 * 调度逻辑：
 * 1. 每天在指定时间段（如 9:00-12:00）内随机选择触发时间
 * 2. 支持配置每天触发次数（maxTriggers）和最小触发间隔（minIntervalMinutes）
 * 3. 每次触发后重新计算当天剩余时间内的下一个随机时间点
 * 4. 跨天时自动重新计算下一窗口
 *
 * 存储方式：利用 cron_expression 字段存储随机窗口配置的 JSON 字符串。
 * 格式：{"type":"random_window","windowStartMinutes":540,"windowEndMinutes":720,"maxTriggers":3,"minIntervalMinutes":30}
 *
 * 适配器 source = 'cron'，与 CronTriggerAdapter 共享事件来源，便于 TriggerEngine 匹配。
 */

import type { AgentEvent, TriggerSource, TriggerAdapter, IEventBus, TriggerSchedule } from '../types';
import type { TriggerStore } from '../trigger-store';
import { generateEventId } from '../action-executor';

/** 随机窗口配置 */
export interface RandomWindowConfig {
  /** 配置类型标识 */
  type: 'random_window';
  /** 每日窗口开始时间（分钟从 00:00 起算，如 540 = 9:00） */
  windowStartMinutes: number;
  /** 每日窗口结束时间（分钟从 00:00 起算，如 720 = 12:00） */
  windowEndMinutes: number;
  /** 每次窗口内最多触发次数 */
  maxTriggers: number;
  /** 同窗口内最小触发间隔（分钟） */
  minIntervalMinutes: number;
}

/** 窗口运行时状态 */
interface WindowRuntimeState {
  /** 当前窗口内已触发次数 */
  triggersInWindow: number;
  /** 当前窗口开始时间戳（毫秒） */
  windowStartTime: number;
  /** 当前窗口结束时间戳（毫秒） */
  windowEndTime: number;
  /** 上次触发时间戳 */
  lastTriggeredAt: number;
}

export class RandomWindowTriggerAdapter implements TriggerAdapter {
  readonly source: TriggerSource = 'cron';

  private eventBus: IEventBus;
  private store: TriggerStore;
  private timeouts: Map<string, NodeJS.Timeout> = new Map();
  /** triggerId → 窗口运行时状态 */
  private windowStates: Map<string, WindowRuntimeState> = new Map();
  private running = false;

  constructor(eventBus: IEventBus, store: TriggerStore) {
    this.eventBus = eventBus;
    this.store = store;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    // 加载所有启用的触发器，找出带有 random_window 配置的
    const triggers = this.store.list({ enabled: true });
    for (const trigger of triggers) {
      const schedule = this.store.getSchedule(trigger.id);
      if (schedule) {
        const config = this.parseRandomWindowConfig(schedule);
        if (config) {
          this.schedule(trigger.id, schedule);
        }
      }
    }
  }

  async stop(): Promise<void> {
    this.running = false;

    for (const timer of this.timeouts.values()) {
      clearTimeout(timer);
    }
    this.timeouts.clear();
    this.windowStates.clear();
  }

  handle(_rawEvent: unknown): AgentEvent | null {
    return null;
  }

  /**
   * 调度指定触发器的随机窗口
   */
  schedule(triggerId: string, schedule: TriggerSchedule): void {
    // 清理旧调度
    this.unschedule(triggerId);

    const config = this.parseRandomWindowConfig(schedule);
    if (!config) return;

    // 计算下一个随机触发时间
    const nextTime = this.calculateNextRandomTime(config);
    if (nextTime === null) return;

    // 初始化窗口状态
    const todayStart = this.getTodayStart();
    this.windowStates.set(triggerId, {
      triggersInWindow: 0,
      windowStartTime: todayStart + config.windowStartMinutes * 60 * 1000,
      windowEndTime: todayStart + config.windowEndMinutes * 60 * 1000,
      lastTriggeredAt: 0,
    });

    // 设置定时器
    const delay = Math.max(nextTime - Date.now(), 1000); // 至少 1 秒
    const timeout = setTimeout(() => {
      this.fire(triggerId, config);
    }, delay);
    this.timeouts.set(triggerId, timeout);

    // 更新调度记录
    this.store.saveSchedule({
      triggerId,
      scheduleType: 'cron', // 复用 cron 类型
      cronExpression: schedule.cronExpression,
      nextScheduledAt: nextTime,
    });
  }

  /** 取消指定触发器的调度 */
  unschedule(triggerId: string): void {
    const timeout = this.timeouts.get(triggerId);
    if (timeout) {
      clearTimeout(timeout);
      this.timeouts.delete(triggerId);
    }
    this.windowStates.delete(triggerId);
  }

  /**
   * 触发事件
   */
  private fire(triggerId: string, config: RandomWindowConfig): void {
    const trigger = this.store.getById(triggerId);
    if (!trigger || !trigger.enabled) return;

    const state = this.windowStates.get(triggerId);
    if (!state) return;

    const now = Date.now();

    // 检查是否仍在当前窗口内
    if (now >= state.windowStartTime && now <= state.windowEndTime) {
      // 更新窗口状态
      state.triggersInWindow++;
      state.lastTriggeredAt = now;

      // 发布事件
      const event: AgentEvent = {
        id: generateEventId(),
        type: 'cron_trigger',
        source: 'cron',
        workspaceId: trigger.workspaceId,
        timestamp: now,
        payload: {
          triggerId,
          scheduleInfo: `random_window:${config.windowStartMinutes}-${config.windowEndMinutes}`,
          triggerName: trigger.name,
          triggersInWindow: state.triggersInWindow,
          maxTriggers: config.maxTriggers,
        },
      };
      this.eventBus.publish(event);

      // 检查是否达到最大触发次数
      if (state.triggersInWindow >= config.maxTriggers) {
        // 本次窗口已结束，清空状态
        this.windowStates.delete(triggerId);
        return;
      }

      // 计算下一次触发时间（在窗口剩余时间内随机）
      const remainingMs = state.windowEndTime - now;
      const minIntervalMs = config.minIntervalMinutes * 60 * 1000;
      const maxNextDelay = Math.max(remainingMs - minIntervalMs, 0);

      if (maxNextDelay < 1000) {
        // 剩余时间不足，结束本次窗口
        this.windowStates.delete(triggerId);
        return;
      }

      // 在 [minInterval, maxNextDelay] 范围内随机
      const nextDelay = minIntervalMs + Math.random() * maxNextDelay;
      const nextTimeout = setTimeout(() => {
        this.fire(triggerId, config);
      }, nextDelay);
      this.timeouts.set(triggerId, nextTimeout);

      // 更新调度记录
      this.store.saveSchedule({
        triggerId,
        scheduleType: 'cron',
        cronExpression: JSON.stringify(config),
        nextScheduledAt: now + nextDelay,
      });
    } else {
      // 窗口已过期，清空状态
      this.windowStates.delete(triggerId);
    }
  }

  /**
   * 解析随机窗口配置
   * 从 TriggerSchedule 的 cron_expression 字段中读取 JSON 配置
   */
  private parseRandomWindowConfig(schedule: TriggerSchedule): RandomWindowConfig | null {
    if (!schedule.cronExpression) return null;

    try {
      const parsed = JSON.parse(schedule.cronExpression);
      if (parsed?.type === 'random_window' &&
          typeof parsed.windowStartMinutes === 'number' &&
          typeof parsed.windowEndMinutes === 'number' &&
          typeof parsed.maxTriggers === 'number' &&
          typeof parsed.minIntervalMinutes === 'number') {
        return parsed as RandomWindowConfig;
      }
    } catch {
      // 不是 JSON 格式，忽略
    }

    return null;
  }

  /**
   * 计算下一个随机触发时间
   *
   * 算法：
   * 1. 如果当前时间 < 窗口起始时间 → 在窗口起始时间后的随机时间
   * 2. 如果当前时间在窗口内 → 在当前时间到窗口结束时间之间的随机时间
   * 3. 如果当前时间 > 窗口结束时间 → 明天窗口内的随机时间
   */
  private calculateNextRandomTime(config: RandomWindowConfig): number | null {
    const now = Date.now();
    const todayStart = this.getTodayStart();

    const windowStartMs = todayStart + config.windowStartMinutes * 60 * 1000;
    const windowEndMs = todayStart + config.windowEndMinutes * 60 * 1000;

    let randomTime: number;

    if (now < windowStartMs) {
      // 窗口尚未开始 → 在窗口内随机
      randomTime = windowStartMs + Math.random() * (windowEndMs - windowStartMs);
    } else if (now <= windowEndMs) {
      // 当前在窗口内 → 在 [now, windowEnd] 之间随机
      const remainingMs = windowEndMs - now;
      const minIntervalMs = config.minIntervalMinutes * 60 * 1000;
      const maxAvailable = Math.max(remainingMs - minIntervalMs, 0);

      if (maxAvailable < 1000) {
        // 剩余时间不足最小间隔，安排到明天
        return this.calculateNextDayRandomTime(config);
      }

      randomTime = now + minIntervalMs + Math.random() * maxAvailable;
    } else {
      // 窗口已结束 → 明天窗口
      return this.calculateNextDayRandomTime(config);
    }

    return randomTime;
  }

  /**
   * 计算明天窗口内的随机时间
   */
  private calculateNextDayRandomTime(config: RandomWindowConfig): number {
    const tomorrowStart = this.getTodayStart() + 24 * 60 * 60 * 1000;
    const windowStartMs = tomorrowStart + config.windowStartMinutes * 60 * 1000;
    const windowEndMs = tomorrowStart + config.windowEndMinutes * 60 * 1000;

    return windowStartMs + Math.random() * (windowEndMs - windowStartMs);
  }

  /**
   * 获取今天 00:00:00 的时间戳
   */
  private getTodayStart(): number {
    const now = new Date();
    return new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      0, 0, 0, 0,
    ).getTime();
  }
}