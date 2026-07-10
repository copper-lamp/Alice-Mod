/**
 * MainAgentTaskQueue — 双 Agent 通信队列
 *
 * QQ Sub-Agent 与主 Agent（游戏 Agent）之间的内部消息通道。
 * 基于内存队列，支持异步提交/轮询/超时管理。
 * 并发控制：同一群同一用户同时只能有一个待处理请求。
 */

import type { GameActionRequest, GameActionResult, QueueStatus } from './types';

/** 队列配置 */
export interface QueueConfig {
  /** 请求超时时间（ms），默认 30s */
  requestTimeout: number;
  /** 最大并发请求数，默认 3 */
  maxConcurrent: number;
  /** 队列最大长度，默认 50 */
  maxQueueSize: number;
}

/** 默认配置 */
const DEFAULT_QUEUE_CONFIG: QueueConfig = {
  requestTimeout: 30_000,
  maxConcurrent: 3,
  maxQueueSize: 50,
};

/** 内部请求条目 */
interface QueueEntry {
  request: GameActionRequest;
  resolve: (result: GameActionResult) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
  status: 'pending' | 'processing' | 'completed';
}

/**
 * 双 Agent 通信队列
 *
 * 使用方式：
 * ```typescript
 * const queue = new MainAgentTaskQueue();
 *
 * // QQ Sub-Agent 提交请求
 * const result = await queue.submit(request);
 *
 * // 主 Agent 轮询
 * const req = queue.poll();
 * if (req) {
 *   const result = await processGameAction(req);
 *   queue.complete(req.id, result);
 * }
 * ```
 */
export class MainAgentTaskQueue {
  private config: QueueConfig;
  private entries: Map<string, QueueEntry> = new Map();
  private pendingIds: string[] = [];
  private processingCount = 0;

  constructor(config?: Partial<QueueConfig>) {
    this.config = { ...DEFAULT_QUEUE_CONFIG, ...config };
  }

  /**
   * 提交游戏操作请求
   * @returns Promise 会在主 Agent 完成处理后 resolve
   */
  submit(request: GameActionRequest): Promise<GameActionResult> {
    // 并发限制检查
    if (this.entries.size >= this.config.maxQueueSize) {
      return Promise.reject(new Error('请求队列已满，请稍后再试'));
    }

    // 同群同用户并发限制
    const existing = Array.from(this.entries.values())
      .filter(e =>
        e.request.sourceUserId === request.sourceUserId &&
        e.request.sourceGroupId === request.sourceGroupId &&
        e.status !== 'completed'
      );

    if (existing.length > 0) {
      return Promise.reject(new Error('您已有正在处理的请求，请等待完成'));
    }

    return new Promise<GameActionResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.entries.delete(request.id);
        this.removePending(request.id);
        reject(new Error('请求超时，主 Agent 未在 30 秒内响应'));
      }, this.config.requestTimeout);

      const entry: QueueEntry = {
        request,
        resolve,
        reject,
        timeout,
        status: 'pending',
      };

      this.entries.set(request.id, entry);
      this.pendingIds.push(request.id);
    });
  }

  /**
   * 主 Agent 轮询待处理请求
   * 返回最旧的待处理请求，并将其标记为 processing
   */
  poll(): GameActionRequest | null {
    if (this.processingCount >= this.config.maxConcurrent) {
      return null;
    }

    // 从 pending 队列头部取
    while (this.pendingIds.length > 0) {
      const id = this.pendingIds.shift()!;
      const entry = this.entries.get(id);

      if (!entry || entry.status !== 'pending') continue;

      entry.status = 'processing';
      this.processingCount++;
      return entry.request;
    }

    return null;
  }

  /**
   * 主 Agent 返回执行结果
   */
  complete(requestId: string, result: GameActionResult): void {
    const entry = this.entries.get(requestId);
    if (!entry) return;

    clearTimeout(entry.timeout);
    entry.status = 'completed';
    this.processingCount = Math.max(0, this.processingCount - 1);

    entry.resolve(result);

    // 延迟清理已完成条目
    setTimeout(() => {
      this.entries.delete(requestId);
    }, 5000);
  }

  /**
   * 主 Agent 报告执行失败
   */
  fail(requestId: string, error: string): void {
    const entry = this.entries.get(requestId);
    if (!entry) return;

    clearTimeout(entry.timeout);
    entry.status = 'completed';
    this.processingCount = Math.max(0, this.processingCount - 1);

    entry.reject(new Error(error));

    setTimeout(() => {
      this.entries.delete(requestId);
    }, 5000);
  }

  /** 获取队列状态 */
  getStatus(): QueueStatus {
    const entries = Array.from(this.entries.values());
    return {
      pending: entries.filter(e => e.status === 'pending').length,
      processing: this.processingCount,
      completed: entries.filter(e => e.status === 'completed').length,
      total: entries.length,
    };
  }

  /** 清理所有超时请求（可由定时任务调用） */
  cleanup(): void {
    const now = Date.now();
    for (const [id, entry] of this.entries) {
      if (entry.status === 'pending' && now - entry.request.timestamp > this.config.requestTimeout) {
        clearTimeout(entry.timeout);
        entry.reject(new Error('请求超时'));
        this.entries.delete(id);
        this.removePending(id);
      }
    }
  }

  private removePending(id: string): void {
    const idx = this.pendingIds.indexOf(id);
    if (idx >= 0) this.pendingIds.splice(idx, 1);
  }
}

/** 全局单例 */
export const mainAgentTaskQueue = new MainAgentTaskQueue();