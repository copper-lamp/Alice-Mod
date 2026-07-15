/**
 * V20 §4.2 LlmRequestScheduler — 类型定义
 *
 * 调度器负责：
 * - 按 provider 维度的令牌桶限流（rps + burst）
 * - 全局并发上限
 * - 请求优先级（trigger > qq > debug）
 * - 指标采集：当前在飞数、队列长度、平均等待
 */

/**
 * 调度优先级。
 * - high：触发器链路（trigger）等关键路径
 * - normal：QQ / 主对话
 * - low：调试 / 后台任务
 *
 * 入队时若队列已满，仅 low 优先级会被立即 reject；high/normal 仍可入队。
 */
export type SchedulePriority = 'high' | 'normal' | 'low';

/**
 * 调度请求描述。
 * 供 MainAgent 在每一轮 LLM 调用前传给 scheduler.schedule()。
 */
export interface ScheduleRequest {
  /** 目标 Provider ID；未配置 rate limit 的 Provider 不做令牌桶限流 */
  providerId?: string;
  /** 优先级，默认 normal */
  priority?: SchedulePriority;
  /** 预估 token 数（保留字段，当前实现按 1 token = 1 request 计量） */
  estimatedTokens?: number;
}

/**
 * 单个 Provider 的速率限制配置。
 */
export interface ProviderRateLimit {
  /** 每秒补充的令牌数（tokens / second） */
  rps: number;
  /** 令牌桶容量（允许的瞬时并发请求数） */
  burst: number;
}

/**
 * Provider 级别的运行时统计。
 */
export interface ProviderStat {
  /** 当前可用令牌数 */
  tokens: number;
  /** 令牌桶容量 */
  capacity: number;
  /** 下一枚令牌可用的时间戳（ms）；已满则等于现在 */
  nextRefillMs: number;
}

/**
 * 调度器整体状态快照。
 */
export interface SchedulerStatus {
  /** 当前在飞请求数（已派发 fn 但尚未 resolve） */
  inFlight: number;
  /** 当前队列长度（已入队但尚未派发） */
  queueLength: number;
  /** 各 Provider 的令牌桶统计 */
  providerStats: Record<string, ProviderStat>;
}

/**
 * 调度器配置。
 */
export interface SchedulerConfig {
  /** 全局并发上限，默认 10 */
  maxConcurrent?: number;
  /** 等待队列上限，默认 100 */
  queueSize?: number;
  /** Provider 速率限制（key = providerId） */
  providerRateLimits?: Record<string, ProviderRateLimit>;
}

/**
 * LlmRequestScheduler 统一接口。
 *
 * 使用方式：
 * ```ts
 * const result = await scheduler.schedule(
 *   { providerId: 'openai', priority: 'normal' },
 *   async () => provider.chat(messages, tools, options),
 * );
 * ```
 */
export interface LlmRequestScheduler {
  /**
   * 调度一次 LLM 调用。
   * - 入队（按优先级）
   * - 等待全局并发槽位 + Provider 令牌
   * - 执行 fn 并返回结果
   *
   * @throws Error 当 low 优先级且队列已满时 reject
   */
  schedule<T>(req: ScheduleRequest, fn: () => Promise<T>): Promise<T>;

  /** 运行时设置 / 更新某 Provider 的速率限制 */
  setProviderRateLimit(providerId: string, rps: number, burst: number): void;

  /** 获取当前调度器状态快照 */
  getStatus(): SchedulerStatus;

  /** 事件订阅：enqueue / dequeue / reject */
  on(event: 'enqueue' | 'dequeue' | 'reject', listener: (...args: unknown[]) => void): this;
}

/**
 * 优先级权重表（数值越大越先派发）。
 */
export const PRIORITY_WEIGHT: Record<SchedulePriority, number> = {
  high: 3,
  normal: 2,
  low: 1,
};

/**
 * 默认调度参数（与 V20 §6.4 配置项默认值对齐）。
 */
export const DEFAULT_SCHEDULER_CONFIG: Required<Pick<SchedulerConfig, 'maxConcurrent' | 'queueSize'>> = {
  maxConcurrent: 10,
  queueSize: 100,
};
