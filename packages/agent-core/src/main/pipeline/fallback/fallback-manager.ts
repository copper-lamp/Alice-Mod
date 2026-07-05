/**
 * FallbackManager 默认实现
 *
 * 管理兜底策略链：重试 → 降级 → 跳过 → 终止。
 * 按顺序尝试策略，第一个适用的策略执行。
 * 支持注册自定义兜底策略。
 */

import type {
  IFallbackManager,
  FallbackStrategy,
  FallbackContext,
  FallbackResult,
  ToolCallContent,
} from '../types';

import { RetryStrategy } from './retry-strategy';
import { DegradeStrategy } from './degrade-strategy';

/**
 * 跳过策略
 */
class SkipStrategy implements FallbackStrategy {
  readonly name = 'skip';

  shouldApply(_call: ToolCallContent, context: FallbackContext): boolean {
    // 降级仍失败后尝试跳过
    return context.attemptCount > 5;
  }

  async execute(call: ToolCallContent, context: FallbackContext): Promise<FallbackResult> {
    return {
      result: {
        type: 'tool_result',
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        success: false,
        error: '已跳过（所有兜底策略均失败）',
        durationMs: 0,
        skipped: true,
        resolvedByFallback: true,
      },
      strategyUsed: 'skip',
      resolved: true,
    };
  }
}

/**
 * 默认兜底策略管理器
 *
 * 策略链顺序：
 * 1. RetryStrategy — 指数退避重试（最多 3 次）
 * 2. DegradeStrategy — 降级执行（Mock / 简化参数 / 跳过）
 * 3. SkipStrategy — 直接跳过
 * 4. 无匹配 — 标记为失败
 */
export class DefaultFallbackManager implements IFallbackManager {
  private strategies: FallbackStrategy[] = [
    new RetryStrategy(),
    new DegradeStrategy(),
    new SkipStrategy(),
  ];

  /**
   * 注册自定义兜底策略
   */
  registerStrategy(name: string, strategy: FallbackStrategy): void {
    // 插入到 retry 之后、degrade 之前
    this.strategies.splice(1, 0, strategy);
  }

  /**
   * 处理失败的工具调用
   *
   * 按顺序尝试策略，第一个 applicable 的策略执行。
   */
  async handle(
    failedCall: ToolCallContent,
    context: FallbackContext,
  ): Promise<FallbackResult> {
    for (const strategy of this.strategies) {
      if (strategy.shouldApply(failedCall, context)) {
        return strategy.execute(failedCall, context);
      }
    }

    // 所有兜底策略均不适用，标记为失败
    return {
      result: {
        type: 'tool_result',
        toolCallId: failedCall.toolCallId,
        toolName: failedCall.toolName,
        success: false,
        error: '所有兜底策略均不适用',
        durationMs: 0,
      },
      strategyUsed: 'none',
      resolved: false,
    };
  }
}