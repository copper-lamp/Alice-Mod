/**
 * BatchScheduler 默认实现
 *
 * 将依赖分析结果（执行层级）转换为具体的 Batch 请求序列。
 * 支持多种调度策略：layered（默认）/ sequential / greedy。
 */

import type { ExecutionLayer, ScheduledBatch, BatchCall, ScheduleOptions, SchedulingStrategy, ToolCallContent } from './types';
import { DEFAULT_SCHEDULE_OPTIONS } from './types';
import type { IBatchScheduler } from './types';

/**
 * 默认 Batch 调度器
 *
 * 按执行层级构造 Batch 请求：
 * - 同一层级的工具放在同一个 Batch 中并行发送
 * - 不同层级顺序执行（前一层完全完成后才发送下一层）
 */
export class DefaultBatchScheduler implements IBatchScheduler {
  private strategy: SchedulingStrategy = 'layered';

  setStrategy(strategy: SchedulingStrategy): void {
    this.strategy = strategy;
  }

  schedule(
    layers: ExecutionLayer[],
    options: ScheduleOptions = DEFAULT_SCHEDULE_OPTIONS,
  ): ScheduledBatch[] {
    const mergedOptions = { ...DEFAULT_SCHEDULE_OPTIONS, ...options };

    switch (this.strategy) {
      case 'sequential':
        return this.scheduleSequential(layers, mergedOptions);
      case 'greedy':
        return this.scheduleGreedy(layers, mergedOptions);
      case 'layered':
      default:
        return this.scheduleLayered(layers, mergedOptions);
    }
  }

  /**
   * 分层调度（默认）
   * 每层一个 Batch，层内并行，层间串行
   */
  private scheduleLayered(
    layers: ExecutionLayer[],
    options: ScheduleOptions,
  ): ScheduledBatch[] {
    return layers.map((layer) => ({
      level: layer.level,
      calls: this.buildBatchCalls(layer.calls, options),
      timeoutMs: options.layerTimeoutMs,
    }));
  }

  /**
   * 顺序调度
   * 每个工具单独一个 Batch，完全串行
   */
  private scheduleSequential(
    layers: ExecutionLayer[],
    options: ScheduleOptions,
  ): ScheduledBatch[] {
    const batches: ScheduledBatch[] = [];
    let level = 0;

    for (const layer of layers) {
      for (const call of layer.calls) {
        batches.push({
          level,
          calls: this.buildBatchCalls([call], options),
          timeoutMs: options.layerTimeoutMs,
        });
        level++;
      }
    }

    return batches;
  }

  /**
   * 贪心调度
   * 尽可能合并同一层的工具，但受 maxConcurrency 限制
   */
  private scheduleGreedy(
    layers: ExecutionLayer[],
    options: ScheduleOptions,
  ): ScheduledBatch[] {
    const batches: ScheduledBatch[] = [];

    for (const layer of layers) {
      for (let i = 0; i < layer.calls.length; i += options.maxConcurrency) {
        const chunk = layer.calls.slice(i, i + options.maxConcurrency);
        batches.push({
          level: layer.level,
          calls: this.buildBatchCalls(chunk, options),
          timeoutMs: options.layerTimeoutMs,
        });
      }
    }

    return batches;
  }

  /**
   * 构建 Batch 调用列表
   */
  private buildBatchCalls(
    calls: ToolCallContent[],
    options: ScheduleOptions,
  ): BatchCall[] {
    return calls.map((call) => ({
      id: call.toolCallId,
      method: 'tool_call',
      params: {
        tool_name: call.toolName,
        parameters: call.arguments as Record<string, unknown>,
        timeout_ms: options.layerTimeoutMs,
      },
    }));
  }
}