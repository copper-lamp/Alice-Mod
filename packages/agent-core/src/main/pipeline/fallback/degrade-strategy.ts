/**
 * 降级兜底策略
 *
 * 提供多种降级方式：
 * 1. simplify_params：移除可选参数，仅保留必填参数重试
 * 2. mock_result：返回预设的假结果（适用于感知类工具）
 * 3. skip：跳过该工具，标记为 skipped
 */

import type { FallbackStrategy, FallbackContext, FallbackResult, ToolCallContent, DegradeStrategyRule, PipelineError } from '../types';

/**
 * 感知类工具名称列表（降级时可返回空结果）
 */
const PerceptionTools = new Set([
  'look_at',
  'get_inventory',
  'get_equipment',
  'get_status',
  'get_position',
  'get_surroundings',
  'memory_query',
  'maps_query',
  'qq_info',
]);

/**
 * 降级策略
 *
 * 适用条件：
 * - 重试已耗尽
 * - 工具可降级执行（如简化参数、Mock 结果）
 */
export class DegradeStrategy implements FallbackStrategy {
  readonly name = 'degrade';

  private readonly degradeStrategies: DegradeStrategyRule[] = [
    {
      name: 'simplify_params',
      match: (error: PipelineError) => error.code === 'INVALID_PARAMS',
      execute: async (call: ToolCallContent) => ({
        result: {
          type: 'tool_result' as const,
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          success: false,
          error: '参数校验失败，降级跳过',
          durationMs: 0,
          resolvedByFallback: true,
        },
        strategyUsed: 'degrade:simplify_params',
        resolved: false,
      }),
    },
    {
      name: 'mock_result',
      match: (error: PipelineError, call: ToolCallContent) =>
        PerceptionTools.has(call.toolName),
      execute: async (call: ToolCallContent) => ({
        result: {
          type: 'tool_result' as const,
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          success: false,
          data: {},
          error: '感知工具降级：返回空结果',
          durationMs: 0,
          resolvedByFallback: true,
        },
        strategyUsed: 'degrade:mock_result',
        resolved: true,
      }),
    },
    {
      name: 'skip',
      match: () => true, // 兜底匹配
      execute: async (call: ToolCallContent) => ({
        result: {
          type: 'tool_result' as const,
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          success: false,
          error: '降级跳过',
          durationMs: 0,
          skipped: true,
          resolvedByFallback: true,
        },
        strategyUsed: 'degrade:skip',
        resolved: true,
      }),
    },
  ];

  shouldApply(_call: ToolCallContent, context: FallbackContext): boolean {
    // 重试耗尽后尝试降级
    return context.attemptCount > 3;
  }

  async execute(call: ToolCallContent, context: FallbackContext): Promise<FallbackResult> {
    const lastError: PipelineError = {
      code: 'UNKNOWN',
      message: context.previousErrors[context.previousErrors.length - 1] || '未知错误',
      toolName: call.toolName,
      toolCallId: call.toolCallId,
    };

    // 按顺序尝试降级策略
    for (const strategy of this.degradeStrategies) {
      if (strategy.match(lastError, call)) {
        return strategy.execute(call, lastError);
      }
    }

    // 默认跳过
    return {
      result: {
        type: 'tool_result',
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        success: false,
        error: '所有降级策略均不适用，跳过',
        durationMs: 0,
        skipped: true,
        resolvedByFallback: true,
      },
      strategyUsed: 'degrade:default_skip',
      resolved: true,
    };
  }
}