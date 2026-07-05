/**
 * 重试兜底策略
 *
 * 指数退避重试，适用于可重试的错误类型。
 * 默认最大重试 3 次，初始间隔 1s，退避乘数 2。
 */

import type { FallbackStrategy, FallbackContext, FallbackResult, ToolCallContent, ToolResultContent } from '../types';
import { DEFAULT_RETRY_OPTIONS } from '../types';

/**
 * 重试策略
 *
 * 适用条件：
 * - 错误类型为可重试的（timeout, network, rate_limit, instance_busy）
 * - 未超过最大重试次数
 * - 剩余时间充足
 */
export class RetryStrategy implements FallbackStrategy {
  readonly name = 'retry';

  private readonly maxRetries: number;
  private readonly initialDelayMs: number;
  private readonly backoffMultiplier: number;
  private readonly maxDelayMs: number;
  private readonly retryableErrors: string[];

  constructor(options?: {
    maxRetries?: number;
    initialDelayMs?: number;
    backoffMultiplier?: number;
    maxDelayMs?: number;
    retryableErrors?: string[];
  }) {
    this.maxRetries = options?.maxRetries ?? DEFAULT_RETRY_OPTIONS.maxRetries;
    this.initialDelayMs = options?.initialDelayMs ?? DEFAULT_RETRY_OPTIONS.initialDelayMs;
    this.backoffMultiplier = options?.backoffMultiplier ?? DEFAULT_RETRY_OPTIONS.backoffMultiplier;
    this.maxDelayMs = options?.maxDelayMs ?? DEFAULT_RETRY_OPTIONS.maxDelayMs;
    this.retryableErrors = options?.retryableErrors ?? DEFAULT_RETRY_OPTIONS.retryableErrors;
  }

  shouldApply(call: ToolCallContent, context: FallbackContext): boolean {
    // 超过最大重试次数则不适用
    if (context.attemptCount > this.maxRetries) return false;

    // 检查错误是否可重试
    const lastError = context.previousErrors[context.previousErrors.length - 1]?.toLowerCase() || '';
    return this.retryableErrors.some((errType) => lastError.includes(errType));
  }

  async execute(call: ToolCallContent, context: FallbackContext): Promise<FallbackResult> {
    const attempt = context.attemptCount;
    const delay = this.calculateDelay(attempt);

    // 等待退避间隔
    await new Promise((resolve) => setTimeout(resolve, delay));

    return {
      result: {
        type: 'tool_result',
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        success: false,
        error: `需要重试 (第 ${attempt} 次)`,
        durationMs: delay,
        resolvedByFallback: true,
      },
      strategyUsed: 'retry',
      resolved: false, // 重试结果由外层 resolve
    };
  }

  /**
   * 计算退避延迟
   */
  private calculateDelay(attempt: number): number {
    const delay = this.initialDelayMs * Math.pow(this.backoffMultiplier, attempt - 1);
    return Math.min(delay, this.maxDelayMs);
  }
}