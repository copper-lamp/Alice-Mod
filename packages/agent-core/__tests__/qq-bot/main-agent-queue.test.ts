/**
 * MainAgentTaskQueue 测试
 *
 * 覆盖：提交/轮询/完成/失败/超时/并发限制/清理
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MainAgentTaskQueue } from '../../src/main/qq-bot/main-agent-queue';
import type { GameActionRequest, GameActionResult } from '../../src/main/qq-bot/types';

describe('MainAgentTaskQueue', () => {
  let queue: MainAgentTaskQueue;

  beforeEach(() => {
    queue = new MainAgentTaskQueue({ requestTimeout: 5000 });
  });

  // ── 基础提交/轮询/完成 ──

  it('应能提交并获取请求', async () => {
    const request: GameActionRequest = {
      id: 'req_1',
      sourceUserId: 'user1',
      description: '检查背包',
      priority: 'normal',
      timestamp: Date.now(),
    };

    const resultPromise = queue.submit(request);
    const polled = queue.poll();

    expect(polled).not.toBeNull();
    expect(polled!.id).toBe('req_1');
    expect(polled!.description).toBe('检查背包');

    const result: GameActionResult = {
      requestId: 'req_1',
      success: true,
      summary: '背包有钻石 x5',
      durationMs: 100,
    };

    queue.complete('req_1', result);
    const actual = await resultPromise;
    expect(actual.success).toBe(true);
    expect(actual.summary).toBe('背包有钻石 x5');
  });

  it('应能处理失败请求', async () => {
    const request: GameActionRequest = {
      id: 'req_fail',
      sourceUserId: 'user1',
      description: '执行操作',
      priority: 'normal',
      timestamp: Date.now(),
    };

    const resultPromise = queue.submit(request);
    queue.poll();
    queue.fail('req_fail', '操作执行失败');

    await expect(resultPromise).rejects.toThrow('操作执行失败');
  });

  it('应返回 null 当队列为空时', () => {
    const polled = queue.poll();
    expect(polled).toBeNull();
  });

  // ── 并发控制 ──

  it('应限制同一用户并发请求', async () => {
    const req1: GameActionRequest = {
      id: 'req_a',
      sourceUserId: 'user1',
      description: '请求1',
      priority: 'normal',
      timestamp: Date.now(),
    };

    const req2: GameActionRequest = {
      id: 'req_b',
      sourceUserId: 'user1',
      description: '请求2',
      priority: 'normal',
      timestamp: Date.now(),
    };

    // 不 await 第一个 submit，因为其 Promise 不会 resolve（无人调用 complete/fail）
    queue.submit(req1);
    await expect(queue.submit(req2)).rejects.toThrow('您已有正在处理的请求');
  });

  it('应允许不同用户并发请求', async () => {
    const req1: GameActionRequest = {
      id: 'req_u1',
      sourceUserId: 'user1',
      description: '用户1请求',
      priority: 'normal',
      timestamp: Date.now(),
    };

    const req2: GameActionRequest = {
      id: 'req_u2',
      sourceUserId: 'user2',
      description: '用户2请求',
      priority: 'normal',
      timestamp: Date.now(),
    };

    // 不 await submit，因为 Promise 不会 resolve
    queue.submit(req1);
    queue.submit(req2);
    expect(queue.getStatus().pending).toBe(2);
  });

  // ── 队列状态 ──

  it('应正确报告队列状态', async () => {
    expect(queue.getStatus().total).toBe(0);

    const req: GameActionRequest = {
      id: 'req_stat',
      sourceUserId: 'user1',
      description: '测试状态',
      priority: 'normal',
      timestamp: Date.now(),
    };

    queue.submit(req);
    expect(queue.getStatus().pending).toBe(1);
    expect(queue.getStatus().total).toBe(1);

    queue.poll();
    expect(queue.getStatus().processing).toBe(1);

    queue.complete('req_stat', {
      requestId: 'req_stat',
      success: true,
      summary: '完成',
      durationMs: 10,
    });

    // 等待异步清理
    await new Promise(r => setTimeout(r, 100));
    expect(queue.getStatus().completed).toBe(1);
  });

  // ── 超时处理 ──

  it('应超时失败', async () => {
    const fastQueue = new MainAgentTaskQueue({ requestTimeout: 100 });
    const req: GameActionRequest = {
      id: 'req_timeout',
      sourceUserId: 'user1',
      description: '超时请求',
      priority: 'normal',
      timestamp: Date.now(),
    };

    await expect(fastQueue.submit(req)).rejects.toThrow('超时');
  });

  // ── 清理 ──

  it('cleanup 应清理超时请求', async () => {
    queue = new MainAgentTaskQueue({ requestTimeout: 50 });

    const req: GameActionRequest = {
      id: 'req_cleanup',
      sourceUserId: 'user1',
      description: '将被清理',
      priority: 'normal',
      timestamp: Date.now() - 100000,
    };

    // 直接添加条目（绕过 submit 的自动超时）
    (queue as any).entries.set('req_cleanup', {
      request: req,
      status: 'pending',
      reject: vi.fn(),
      resolve: vi.fn(),
      timeout: setTimeout(() => {}, 100000),
    });
    (queue as any).pendingIds.push('req_cleanup');

    queue.cleanup();

    // 超时请求应被清理
    expect(queue.getStatus().pending).toBe(0);
  });

  it('cleanup 不应清理未超时的请求', async () => {
    queue = new MainAgentTaskQueue({ requestTimeout: 50000 });

    const req: GameActionRequest = {
      id: 'req_fresh',
      sourceUserId: 'user1',
      description: '新请求',
      priority: 'normal',
      timestamp: Date.now(),
    };

    (queue as any).entries.set('req_fresh', {
      request: req,
      status: 'pending',
      reject: vi.fn(),
      resolve: vi.fn(),
      timeout: setTimeout(() => {}, 100000),
    });
    (queue as any).pendingIds.push('req_fresh');

    queue.cleanup();

    // 未超时的请求应保留
    expect(queue.getStatus().pending).toBe(1);
  });

  // ── 并发处理限制 ──

  it('poll 应遵守 maxConcurrent 限制', () => {
    const limitedQueue = new MainAgentTaskQueue({ maxConcurrent: 1, requestTimeout: 5000 });

    limitedQueue.submit({ id: '1', sourceUserId: 'u1', description: 'r1', priority: 'normal', timestamp: Date.now() }).catch(() => {});
    limitedQueue.submit({ id: '2', sourceUserId: 'u2', description: 'r2', priority: 'normal', timestamp: Date.now() }).catch(() => {});

    const first = limitedQueue.poll();
    expect(first).not.toBeNull();
    expect(first!.id).toBe('1');

    // 已达 maxConcurrent，第二个 poll 应返回 null
    const second = limitedQueue.poll();
    expect(second).toBeNull();
  });

  it('complete 后应释放并发槽位', () => {
    const limitedQueue = new MainAgentTaskQueue({ maxConcurrent: 1, requestTimeout: 5000 });

    limitedQueue.submit({ id: '1', sourceUserId: 'u1', description: 'r1', priority: 'normal', timestamp: Date.now() });
    limitedQueue.submit({ id: '2', sourceUserId: 'u2', description: 'r2', priority: 'normal', timestamp: Date.now() }).catch(() => {});

    const first = limitedQueue.poll();
    expect(first).not.toBeNull();

    limitedQueue.complete('1', { requestId: '1', success: true, summary: 'done', durationMs: 10 });

    // complete 后释放了槽位，可以 poll 下一个
    const second = limitedQueue.poll();
    expect(second).not.toBeNull();
    expect(second!.id).toBe('2');
  });

  it('fail 后应释放并发槽位', () => {
    const limitedQueue = new MainAgentTaskQueue({ maxConcurrent: 1, requestTimeout: 5000 });

    // 抑制未 await 的 Promise rejection
    limitedQueue.submit({ id: '1', sourceUserId: 'u1', description: 'r1', priority: 'normal', timestamp: Date.now() }).catch(() => {});
    limitedQueue.submit({ id: '2', sourceUserId: 'u2', description: 'r2', priority: 'normal', timestamp: Date.now() }).catch(() => {});

    limitedQueue.poll();
    limitedQueue.fail('1', '操作失败');

    const second = limitedQueue.poll();
    expect(second).not.toBeNull();
    expect(second!.id).toBe('2');
  });

  // ── 队列满 ──

  it('队列满时应拒绝请求', async () => {
    const smallQueue = new MainAgentTaskQueue({ maxQueueSize: 2 });

    // 不 await submit，因为 Promise 不会 resolve
    smallQueue.submit({ id: '1', sourceUserId: 'u1', description: 'r1', priority: 'normal', timestamp: Date.now() });
    smallQueue.submit({ id: '2', sourceUserId: 'u2', description: 'r2', priority: 'normal', timestamp: Date.now() });

    await expect(
      smallQueue.submit({ id: '3', sourceUserId: 'u3', description: 'r3', priority: 'normal', timestamp: Date.now() })
    ).rejects.toThrow('队列已满');
  });
});