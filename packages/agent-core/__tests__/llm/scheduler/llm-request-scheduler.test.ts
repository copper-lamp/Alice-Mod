/**
 * V20 §4.2 DefaultLlmRequestScheduler 单元测试
 *
 * 验收覆盖（设计文档 §8 阶段 9.2）：
 * - 令牌桶限流（rps + burst）
 * - 全局并发上限
 * - 优先级排队
 * - 队列满 + low 优先级 reject
 * - 事件 emit（enqueue / dequeue / reject）
 * - setProviderRateLimit 运行时更新
 * - 未配置 rate limit 的 Provider 不限速
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DefaultLlmRequestScheduler } from '../../../src/main/llm/scheduler/llm-request-scheduler';
import type { SchedulerConfig } from '../../../src/main/llm/scheduler/types';

// ═══════════════════════════════════════════════════════════
// 辅助：让 vitest 使用真实定时器（令牌桶依赖 setTimeout）
// 默认使用 real timers；个别用例需要 fake 时单独切换。
// ═══════════════════════════════════════════════════════════

function makeImmediateFn<T>(value: T, delay = 0): () => Promise<T> {
  return () =>
    new Promise<T>((resolve) => {
      setTimeout(() => resolve(value), delay);
    });
}

/**
 * 让出一个宏任务周期，确保所有 pending 微任务（包括 scheduler pump 派发下一项 +
 * 调用其 fn() 设置 resolveFn）都执行完毕。
 *
 * 必要性：scheduler.executeItem 在 await waitForToken 后才调 fn()，这发生在微任务中。
 * 当我们 release() 当前项并 await 其 promise 后，下一项的 fn() 可能尚未被调用
 * （微任务执行顺序：promise continuation 先于 executeItem continuation）。
 * 用 setTimeout(0) 让出到宏任务边界，可保证后续微任务全部跑完。
 */
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** 创建一个可被外部控制的 pending fn：调 release() 才 resolve */
function makeControlledFn<T>(value: T): { fn: () => Promise<T>; release: () => void } {
  let resolveFn!: (v: T) => void;
  const fn = () => new Promise<T>((resolve) => { resolveFn = resolve; });
  const release = () => resolveFn(value);
  return { fn, release };
}

describe('DefaultLlmRequestScheduler', () => {
  let scheduler: DefaultLlmRequestScheduler;

  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ───────────────────────────────────────────────────────
  // 1. 令牌桶限流
  // ───────────────────────────────────────────────────────
  describe('令牌桶限流', () => {
    it('未配置 rate limit 的 Provider 不限速（burst 全通过）', async () => {
      scheduler = new DefaultLlmRequestScheduler({ maxConcurrent: 10, queueSize: 50 });
      const start = Date.now();
      await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          scheduler.schedule({ providerId: 'unknown' }, makeImmediateFn(i)),
        ),
      );
      const elapsed = Date.now() - start;
      // 5 个并发立刻完成，无 rate limit 等待
      expect(elapsed).toBeLessThan(500);
    });

    it('rps=2 burst=2 时，5 个请求总耗时约 (5-2)/2 = 1.5s', async () => {
      scheduler = new DefaultLlmRequestScheduler({
        maxConcurrent: 10,
        queueSize: 50,
        providerRateLimits: { openai: { rps: 2, burst: 2 } },
      });
      const start = Date.now();
      const results = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          scheduler.schedule({ providerId: 'openai' }, makeImmediateFn(i)),
        ),
      );
      const elapsed = Date.now() - start;

      expect(results).toEqual([0, 1, 2, 3, 4]);
      // 2 个走 burst，剩 3 个需等令牌：(3-1)/2 = 1s 起步，实际约 1000~1500ms
      expect(elapsed).toBeGreaterThanOrEqual(900);
      expect(elapsed).toBeLessThan(2000);
    });

    it('setProviderRateLimit 运行时更新立即生效', async () => {
      scheduler = new DefaultLlmRequestScheduler({ maxConcurrent: 10, queueSize: 50 });
      // 第一批：无限制，应该飞快
      const t1 = Date.now();
      await Promise.all(
        Array.from({ length: 3 }, (_, i) =>
          scheduler.schedule({ providerId: 'openai' }, makeImmediateFn(i)),
        ),
      );
      expect(Date.now() - t1).toBeLessThan(300);

      // 设置 rps=1 burst=1
      scheduler.setProviderRateLimit('openai', 1, 1);
      // 第二批：3 个请求，第 1 个走 burst，剩 2 个等 2s
      const t2 = Date.now();
      await Promise.all(
        Array.from({ length: 3 }, (_, i) =>
          scheduler.schedule({ providerId: 'openai' }, makeImmediateFn(i)),
        ),
      );
      const elapsed2 = Date.now() - t2;
      expect(elapsed2).toBeGreaterThanOrEqual(1800);
      expect(elapsed2).toBeLessThan(3000);
    });
  });

  // ───────────────────────────────────────────────────────
  // 2. 全局并发上限
  // ───────────────────────────────────────────────────────
  describe('全局并发上限', () => {
    it('maxConcurrent=2 时同时 inFlight 不超过 2', async () => {
      scheduler = new DefaultLlmRequestScheduler({ maxConcurrent: 2, queueSize: 50 });
      let currentInFlight = 0;
      let maxObservedInFlight = 0;

      const makeFn = (i: number) => async () => {
        currentInFlight++;
        maxObservedInFlight = Math.max(maxObservedInFlight, currentInFlight);
        // 模拟 LLM 调用耗时
        await new Promise<void>((r) => setTimeout(r, 50));
        currentInFlight--;
        return i;
      };

      const results = await Promise.all(
        Array.from({ length: 5 }, (_, i) => scheduler.schedule({}, makeFn(i))),
      );

      expect(results).toEqual([0, 1, 2, 3, 4]);
      expect(maxObservedInFlight).toBeLessThanOrEqual(2);
    });

    it('getStatus 反映 inFlight 与 queueLength', async () => {
      scheduler = new DefaultLlmRequestScheduler({ maxConcurrent: 2, queueSize: 50 });
      const controlled: Array<() => void> = [];
      const fns: Array<() => Promise<number>> = [];

      for (let i = 0; i < 5; i++) {
        const c = makeControlledFn(i);
        controlled.push(c.release);
        fns.push(c.fn);
      }

      // 同时发起 5 个，maxConcurrent=2 → 2 个执行中，3 个排队
      const promises = fns.map((fn, i) => scheduler.schedule({}, fn));
      await new Promise<void>((r) => setTimeout(r, 50)); // 等 pump 完成

      const status = scheduler.getStatus();
      expect(status.inFlight).toBe(2);
      expect(status.queueLength).toBe(3);

      // 释放第一个
      controlled[0]!();
      await promises[0]!;
      await new Promise<void>((r) => setTimeout(r, 30));

      const status2 = scheduler.getStatus();
      expect(status2.inFlight).toBe(2); // 又派发一个
      expect(status2.queueLength).toBe(2);

      // 释放剩余（逐个释放 + await，确保下一项被派发并调用 fn() 后再 release）
      for (let i = 1; i < controlled.length; i++) {
        controlled[i]!();
        await promises[i]!;
        await tick();
      }

      const status3 = scheduler.getStatus();
      expect(status3.inFlight).toBe(0);
      expect(status3.queueLength).toBe(0);
    });
  });

  // ───────────────────────────────────────────────────────
  // 3. 优先级排队
  // ───────────────────────────────────────────────────────
  describe('优先级排队', () => {
    it('high 优先级先于 normal / low 派发', async () => {
      scheduler = new DefaultLlmRequestScheduler({ maxConcurrent: 1, queueSize: 50 });
      const order: string[] = [];

      // 先占住唯一槽位
      const blocker = makeControlledFn('blocker');
      const blockerPromise = scheduler.schedule({}, blocker.fn);
      await new Promise<void>((r) => setTimeout(r, 20)); // 等 blocker 入 inFlight

      // 此时 inFlight=1，后续 3 个都会排队
      const p1 = scheduler.schedule({ priority: 'low' }, async () => { order.push('low'); return 'low'; });
      const p2 = scheduler.schedule({ priority: 'normal' }, async () => { order.push('normal'); return 'normal'; });
      const p3 = scheduler.schedule({ priority: 'high' }, async () => { order.push('high'); return 'high'; });

      // 释放 blocker，队列应按 high → normal → low 派发
      blocker.release();
      await Promise.all([blockerPromise, p1, p2, p3]);

      expect(order).toEqual(['high', 'normal', 'low']);
    });

    it('同优先级按 FIFO 顺序', async () => {
      scheduler = new DefaultLlmRequestScheduler({ maxConcurrent: 1, queueSize: 50 });
      const order: number[] = [];

      const blocker = makeControlledFn(-1);
      const blockerPromise = scheduler.schedule({}, blocker.fn);
      await new Promise<void>((r) => setTimeout(r, 20));

      // 全部 normal 优先级，按入队顺序排
      const fns: Array<Promise<unknown>> = [];
      for (let i = 0; i < 5; i++) {
        fns.push(scheduler.schedule({ priority: 'normal' }, async () => { order.push(i); return i; }));
      }

      blocker.release();
      await Promise.all([blockerPromise, ...fns]);

      expect(order).toEqual([0, 1, 2, 3, 4]);
    });

    it('默认优先级为 normal', async () => {
      scheduler = new DefaultLlmRequestScheduler({ maxConcurrent: 1, queueSize: 50 });
      const order: string[] = [];

      const blocker = makeControlledFn('blocker');
      const blockerPromise = scheduler.schedule({}, blocker.fn);
      await new Promise<void>((r) => setTimeout(r, 20));

      // 不指定 priority → normal；显式 high 应排在前面
      const pDefault = scheduler.schedule({}, async () => { order.push('default'); return 'default'; });
      const pHigh = scheduler.schedule({ priority: 'high' }, async () => { order.push('high'); return 'high'; });

      blocker.release();
      await Promise.all([blockerPromise, pDefault, pHigh]);

      expect(order).toEqual(['high', 'default']);
    });
  });

  // ───────────────────────────────────────────────────────
  // 4. 队列满 + low 优先级 reject
  // ───────────────────────────────────────────────────────
  describe('队列满 reject', () => {
    it('low 优先级 + 队列满 → 立即 reject', async () => {
      scheduler = new DefaultLlmRequestScheduler({ maxConcurrent: 1, queueSize: 2 });

      // 占住槽位
      const blocker = makeControlledFn('blocker');
      const blockerPromise = scheduler.schedule({}, blocker.fn);
      await new Promise<void>((r) => setTimeout(r, 20));

      // 填满队列（2 个）
      const c1 = makeControlledFn('a');
      const c2 = makeControlledFn('b');
      const p1 = scheduler.schedule({ priority: 'normal' }, c1.fn);
      const p2 = scheduler.schedule({ priority: 'normal' }, c2.fn);
      await new Promise<void>((r) => setTimeout(r, 10));
      expect(scheduler.getStatus().queueLength).toBe(2);

      // 第 3 个 low 优先级 → 立即 reject
      await expect(
        scheduler.schedule({ priority: 'low' }, makeImmediateFn('rejected')),
      ).rejects.toThrow(/queue full/);

      // 释放所有（逐个：blocker 完成后 c1 才被派发，c1 完成后 c2 才被派发）
      blocker.release();
      await blockerPromise;
      await tick();
      c1.release();
      await p1;
      await tick();
      c2.release();
      await p2;
    });

    it('队列满 + high 优先级仍可入队', async () => {
      scheduler = new DefaultLlmRequestScheduler({ maxConcurrent: 1, queueSize: 2 });

      const blocker = makeControlledFn('blocker');
      const blockerPromise = scheduler.schedule({}, blocker.fn);
      await new Promise<void>((r) => setTimeout(r, 20));

      // 填满队列
      const c1 = makeControlledFn('a');
      const c2 = makeControlledFn('b');
      const p1 = scheduler.schedule({ priority: 'normal' }, c1.fn);
      const p2 = scheduler.schedule({ priority: 'normal' }, c2.fn);
      await new Promise<void>((r) => setTimeout(r, 10));

      // high 优先级仍可入队（队列长度变 3，超过 queueSize 但允许）
      const c3 = makeControlledFn('high');
      const p3 = scheduler.schedule({ priority: 'high' }, c3.fn);
      await new Promise<void>((r) => setTimeout(r, 10));
      expect(scheduler.getStatus().queueLength).toBe(3);

      // 释放所有，按 high → a → b 顺序完成
      // 每次释放后 await promise + tick()，确保下一项被派发并调用 fn()
      blocker.release();
      await new Promise<void>((r) => setTimeout(r, 20));
      c3.release();
      await p3;
      await tick();
      c1.release();
      await p1;
      await tick();
      c2.release();
      await p2;
      await blockerPromise;
    });
  });

  // ───────────────────────────────────────────────────────
  // 5. 事件 emit
  // ───────────────────────────────────────────────────────
  describe('事件 emit', () => {
    it('enqueue / dequeue 事件触发', async () => {
      scheduler = new DefaultLlmRequestScheduler({ maxConcurrent: 1, queueSize: 50 });
      const enqueueSpy = vi.fn();
      const dequeueSpy = vi.fn();
      scheduler.on('enqueue', enqueueSpy);
      scheduler.on('dequeue', dequeueSpy);

      await scheduler.schedule({}, makeImmediateFn('ok'));

      expect(enqueueSpy).toHaveBeenCalledTimes(1);
      expect(dequeueSpy).toHaveBeenCalledTimes(1);
      expect(dequeueSpy.mock.calls[0]![0]).toHaveProperty('waitedMs');
      expect(dequeueSpy.mock.calls[0]![0]).toHaveProperty('req');
    });

    it('reject 事件在 low 优先级被拒时触发', async () => {
      scheduler = new DefaultLlmRequestScheduler({ maxConcurrent: 1, queueSize: 1 });
      const rejectSpy = vi.fn();
      scheduler.on('reject', rejectSpy);

      // 占住槽位 + 填满队列
      const blocker = makeControlledFn('blocker');
      const blockerPromise = scheduler.schedule({}, blocker.fn);
      const filler = makeControlledFn('filler');
      const fillerPromise = scheduler.schedule({ priority: 'normal' }, filler.fn);
      await new Promise<void>((r) => setTimeout(r, 20));

      // low 优先级被拒
      await expect(
        scheduler.schedule({ priority: 'low' }, makeImmediateFn('rejected')),
      ).rejects.toThrow();

      expect(rejectSpy).toHaveBeenCalledTimes(1);
      expect(rejectSpy.mock.calls[0]![0]).toMatchObject({
        reason: 'queue_full',
      });

      // 释放：blocker 完成后 filler 才被派发
      blocker.release();
      await blockerPromise;
      await tick();
      filler.release();
      await fillerPromise;
    });
  });

  // ───────────────────────────────────────────────────────
  // 6. 错误透传
  // ───────────────────────────────────────────────────────
  describe('错误透传', () => {
    it('fn 抛错时 reject 给调用方，不阻塞后续请求', async () => {
      scheduler = new DefaultLlmRequestScheduler({ maxConcurrent: 1, queueSize: 50 });

      const p1 = scheduler.schedule({}, async () => { throw new Error('boom'); });
      const p2 = scheduler.schedule({}, makeImmediateFn('ok'));

      await expect(p1).rejects.toThrow('boom');
      await expect(p2).resolves.toBe('ok');
    });
  });

  // ───────────────────────────────────────────────────────
  // 7. getStatus providerStats
  // ───────────────────────────────────────────────────────
  describe('getStatus providerStats', () => {
    it('未触发任何请求时 providerStats 为空', () => {
      scheduler = new DefaultLlmRequestScheduler({
        providerRateLimits: { openai: { rps: 5, burst: 10 } },
      });
      const status = scheduler.getStatus();
      expect(status.inFlight).toBe(0);
      expect(status.queueLength).toBe(0);
      expect(status.providerStats).toEqual({});
    });

    it('触发过请求后 providerStats 反映桶状态', async () => {
      scheduler = new DefaultLlmRequestScheduler({
        maxConcurrent: 5,
        providerRateLimits: { openai: { rps: 5, burst: 3 } },
      });
      // 触发桶创建
      await scheduler.schedule({ providerId: 'openai' }, makeImmediateFn('ok'));

      const status = scheduler.getStatus();
      expect(status.providerStats.openai).toBeDefined();
      expect(status.providerStats.openai!.capacity).toBe(3);
      // 桶会随时间补充，tokens 应 ≥0 且 ≤ capacity
      expect(status.providerStats.openai!.tokens).toBeGreaterThanOrEqual(0);
      expect(status.providerStats.openai!.tokens).toBeLessThanOrEqual(3);
    });
  });
});
