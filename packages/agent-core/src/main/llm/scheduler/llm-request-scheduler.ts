/**
 * V20 §4.2 LlmRequestScheduler — 默认实现
 *
 * 核心机制：
 * 1. 全局并发上限（maxConcurrent）—— 同时执行的 fn 数量不超过此值
 * 2. 按 Provider 维度的令牌桶（rps + burst）—— 限制每秒请求数与瞬时并发
 * 3. 优先级队列（high > normal > low）—— 同等条件下高优先级先派发；
 *    队列已满时仅 low 优先级会被 reject，high/normal 仍可入队
 * 4. 事件通知（enqueue / dequeue / reject）—— 与 LLMObserver 联动写 metrics
 *
 * 实现要点（与设计文档对齐）：
 * - 内部用一个有界队列（默认 100）+ 每个 Provider 一个令牌桶
 * - enqueue 时若队列满 + 优先级 low 则 reject；否则按优先级插入
 * - worker 循环：取队首 → 等令牌 → 调 fn → 释放令牌
 * - 与 LLMObserver 联动：每次 schedule 完成 emit `dequeue` 事件
 */

import { EventEmitter } from 'node:events';
import type {
  LlmRequestScheduler,
  SchedulePriority,
  ScheduleRequest,
  SchedulerConfig,
  SchedulerStatus,
  ProviderRateLimit,
  ProviderStat,
} from './types';
import { DEFAULT_SCHEDULER_CONFIG, PRIORITY_WEIGHT } from './types';

/** 内部令牌桶 */
interface TokenBucket {
  rps: number;
  capacity: number;
  tokens: number;
  lastRefillMs: number;
}

/** 队列项 */
interface QueueItem<T = unknown> {
  req: ScheduleRequest;
  fn: () => Promise<T>;
  resolve: (v: T) => void;
  reject: (e: Error) => void;
  enqueuedAt: number;
  priority: SchedulePriority;
  weight: number;
  /** 同优先级 FIFO 的 tiebreaker */
  seq: number;
}

/**
 * 默认调度器实现。
 *
 * 线程模型：所有同步状态操作在 Node 主线程完成；waitForToken 用 setTimeout 让出事件循环。
 * pump() 是非阻塞的——派发后立即返回，fn 异步执行，完成后再次触发 pump。
 */
export class DefaultLlmRequestScheduler extends EventEmitter implements LlmRequestScheduler {
  private readonly maxConcurrent: number;
  private readonly maxQueueSize: number;
  private readonly providerRateLimits: Map<string, ProviderRateLimit> = new Map();
  private readonly buckets: Map<string, TokenBucket> = new Map();

  private queue: QueueItem[] = [];
  private inFlight = 0;
  private seq = 0;

  constructor(config: SchedulerConfig = {}) {
    super();
    this.maxConcurrent = config.maxConcurrent ?? DEFAULT_SCHEDULER_CONFIG.maxConcurrent;
    this.maxQueueSize = config.queueSize ?? DEFAULT_SCHEDULER_CONFIG.queueSize;
    if (config.providerRateLimits) {
      for (const [k, v] of Object.entries(config.providerRateLimits)) {
        this.providerRateLimits.set(k, { rps: v.rps, burst: v.burst });
      }
    }
  }

  /** 运行时设置 / 更新某 Provider 的速率限制（立即生效，重置该 Provider 的桶） */
  setProviderRateLimit(providerId: string, rps: number, burst: number): void {
    this.providerRateLimits.set(providerId, { rps, burst });
    // 重置桶：下一笔请求将以新配置初始化
    this.buckets.delete(providerId);
  }

  /** 调度一次 LLM 调用 */
  schedule<T>(req: ScheduleRequest, fn: () => Promise<T>): Promise<T> {
    const priority: SchedulePriority = req.priority ?? 'normal';

    // 队列满 + low 优先级 → 立即 reject
    if (this.queue.length >= this.maxQueueSize && priority === 'low') {
      const err = new Error(
        `[LlmRequestScheduler] queue full (size=${this.maxQueueSize}), low-priority request rejected`,
      );
      this.emit('reject', { req, reason: 'queue_full', queueLength: this.queue.length });
      return Promise.reject(err);
    }

    return new Promise<T>((resolve, reject) => {
      const item: QueueItem<T> = {
        req,
        fn,
        resolve,
        reject,
        enqueuedAt: Date.now(),
        priority,
        weight: PRIORITY_WEIGHT[priority],
        seq: ++this.seq,
      };
      this.insertByPriority(item as QueueItem);
      this.emit('enqueue', { req, queueLength: this.queue.length });
      this.pump();
    });
  }

  /** 获取调度器状态快照 */
  getStatus(): SchedulerStatus {
    const providerStats: Record<string, ProviderStat> = {};
    for (const [pid, bucket] of this.buckets) {
      // 读时也 refill 一次，保证返回值反映最新可用令牌
      this.refill(bucket);
      providerStats[pid] = {
        tokens: bucket.tokens,
        capacity: bucket.capacity,
        nextRefillMs:
          bucket.tokens >= bucket.capacity
            ? Date.now()
            : Date.now() + Math.ceil((1 - bucket.tokens) / bucket.rps * 1000),
      };
    }
    return {
      inFlight: this.inFlight,
      queueLength: this.queue.length,
      providerStats,
    };
  }

  // ════════════════════════════════════════════════════════════
  // 内部实现
  // ════════════════════════════════════════════════════════════

  /**
   * 按优先级插入队列（稳定排序：weight desc, seq asc）。
   * 使用二分查找定位插入位置，O(log n) 比较 + O(n) 移动。
   */
  private insertByPriority(item: QueueItem): void {
    let lo = 0;
    let hi = this.queue.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      const m = this.queue[mid]!;
      if (m.weight > item.weight) {
        lo = mid + 1;
      } else if (m.weight < item.weight) {
        hi = mid;
      } else if (m.seq < item.seq) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    this.queue.splice(lo, 0, item);
  }

  /**
   * 派发泵：在不超过 maxConcurrent 的前提下，尽可能多地把队首请求派发出去。
   * 派发是异步的（不 await fn），每个 fn 完成后会再次触发 pump。
   */
  private pump(): void {
    while (this.inFlight < this.maxConcurrent && this.queue.length > 0) {
      const item = this.queue.shift()!;
      this.inFlight++;
      // 异步执行，不阻塞 pump 循环
      this.executeItem(item).catch(() => {
        // executeItem 内部已 reject 给调用方，这里只防 unhandledRejection
      });
    }
  }

  /**
   * 执行单个队列项：等令牌 → 调 fn → resolve / reject → 释放槽位 → 触发下一轮 pump。
   */
  private async executeItem<T>(item: QueueItem<T>): Promise<void> {
    try {
      const bucket = this.getOrCreateBucket(item.req.providerId);
      await this.waitForToken(bucket);

      this.emit('dequeue', {
        req: item.req,
        waitedMs: Date.now() - item.enqueuedAt,
      });

      const result = await item.fn();
      item.resolve(result);
    } catch (err) {
      item.reject(err instanceof Error ? err : new Error(String(err)));
    } finally {
      this.inFlight--;
      // 槽位释放，尝试派发下一项
      this.pump();
    }
  }

  /** 获取或创建 Provider 的令牌桶；未配置 rate limit 时返回 undefined */
  private getOrCreateBucket(providerId?: string): TokenBucket | undefined {
    if (!providerId) return undefined;
    const existing = this.buckets.get(providerId);
    if (existing) return existing;

    const limit = this.providerRateLimits.get(providerId);
    if (!limit) return undefined; // 未配置 → 不限速

    const bucket: TokenBucket = {
      rps: limit.rps,
      capacity: limit.burst,
      tokens: limit.burst, // 初始满桶，允许冷启动 burst
      lastRefillMs: Date.now(),
    };
    this.buckets.set(providerId, bucket);
    return bucket;
  }

  /** 按时间补充令牌（不超过 capacity） */
  private refill(bucket: TokenBucket): void {
    const now = Date.now();
    const elapsedSec = (now - bucket.lastRefillMs) / 1000;
    if (elapsedSec > 0) {
      bucket.tokens = Math.min(bucket.capacity, bucket.tokens + elapsedSec * bucket.rps);
      bucket.lastRefillMs = now;
    }
  }

  /**
   * 阻塞等待至少 1 枚令牌。
   * - 桶为 undefined（未配置 rate limit）时立即返回
   * - 否则循环：refill → 若 tokens ≥ 1 消费并返回；否则 setTimeout 等下一枚令牌
   */
  private async waitForToken(bucket: TokenBucket | undefined): Promise<void> {
    if (!bucket) return;
    while (true) {
      this.refill(bucket);
      if (bucket.tokens >= 1) {
        bucket.tokens -= 1;
        return;
      }
      // 距下一枚令牌的时间（秒）= 缺口 / rps
      const deficit = 1 - bucket.tokens;
      const waitMs = Math.max(1, Math.ceil((deficit / bucket.rps) * 1000));
      await new Promise<void>((r) => setTimeout(r, waitMs));
    }
  }
}
