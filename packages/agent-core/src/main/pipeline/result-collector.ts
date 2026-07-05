/**
 * ResultCollector 默认实现
 *
 * 管理多个 Batch 的完整执行生命周期：
 * - 逐层执行（前一层完成后才执行下一层）
 * - 支持中止信号
 * - 支持 failFast 模式
 * - 提供结果处理器注册
 */

import type {
  IResultCollector,
  IToolDispatcher,
  ScheduledBatch,
  CollectResult,
  ToolResultContent,
  CollectOptions,
  ResultHandler,
} from './types';
import { DEFAULT_COLLECT_OPTIONS } from './types';

/**
 * 睡眠辅助函数
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 默认结果收集器
 *
 * 按层级顺序执行 Batch：
 * 1. 执行当前层的所有 Batch（并发执行同层内的 Batch）
 * 2. 等待所有结果返回
 * 3. 检查 failFast 条件
 * 4. 进入下一层
 */
export class DefaultResultCollector implements IResultCollector {
  private resultHandlers: ResultHandler[] = [];

  /**
   * 注册结果处理器
   */
  onResult(handler: ResultHandler): void {
    this.resultHandlers.push(handler);
  }

  /**
   * 收集所有层级的执行结果
   */
  async collect(
    batches: ScheduledBatch[],
    dispatcher: IToolDispatcher,
    workspaceId: string,
    options: CollectOptions = DEFAULT_COLLECT_OPTIONS,
    abortSignal?: AbortSignal,
  ): Promise<CollectResult> {
    const mergedOptions = { ...DEFAULT_COLLECT_OPTIONS, ...options };
    const allResults: ToolResultContent[] = [];
    const startTime = Date.now();
    let hasErrors = false;

    // 按层级分组
    const levelGroups = this.groupByLevel(batches);

    for (const [level, levelBatches] of levelGroups) {
      // 检查是否已中止
      if (abortSignal?.aborted) {
        // 剩余未执行的调用标记为取消
        const remaining = this.getRemainingCalls(levelGroups, level);
        for (const call of remaining) {
          allResults.push({
            type: 'tool_result',
            toolCallId: call.id,
            toolName: call.params.tool_name,
            success: false,
            error: '管线被中止',
            errorCode: 'PIPELINE_ABORTED',
            durationMs: 0,
            cancelled: true,
          });
        }
        break;
      }

      // 并发执行当前层的所有 Batch（通常只有一个 Batch/层）
      const layerPromises = levelBatches.map((batch) =>
        this.executeSingleBatch(batch, dispatcher, workspaceId, mergedOptions, abortSignal),
      );

      const layerResults = await Promise.all(layerPromises);

      for (const batchResult of layerResults) {
        for (const toolResult of batchResult.results) {
          const resultContent: ToolResultContent = {
            type: 'tool_result',
            toolCallId: toolResult.id,
            toolName: toolResult.toolName,
            success: toolResult.success,
            data: toolResult.data,
            error: toolResult.error,
            errorCode: toolResult.errorCode,
            durationMs: toolResult.durationMs,
          };

          allResults.push(resultContent);

          // 通知结果处理器
          for (const handler of this.resultHandlers) {
            handler(resultContent);
          }

          // 记录失败
          if (!toolResult.success) {
            hasErrors = true;
          }
        }
      }

      // 检查 failFast
      if (hasErrors && mergedOptions.failFast) {
        break;
      }

      // 层级间等待
      if (levelBatches.length > 0 && mergedOptions.interLayerDelayMs > 0) {
        await sleep(mergedOptions.interLayerDelayMs);
      }
    }

    const totalDurationMs = Date.now() - startTime;
    const successCount = allResults.filter((r) => r.success && !r.cancelled).length;
    const failCount = allResults.filter((r) => !r.success && !r.cancelled).length;
    const cancelledCount = allResults.filter((r) => r.cancelled).length;

    return {
      results: allResults,
      successCount,
      failCount,
      totalDurationMs,
      toolDurations: allResults
        .filter((r) => !r.cancelled)
        .map((r) => ({
          toolName: r.toolName || r.toolCallId,
          durationMs: r.durationMs,
          success: r.success,
        })),
      hasErrors: hasErrors || failCount > 0,
    };
  }

  /**
   * 按层级分组
   */
  private groupByLevel(
    batches: ScheduledBatch[],
  ): Map<number, ScheduledBatch[]> {
    const groups = new Map<number, ScheduledBatch[]>();
    for (const batch of batches) {
      const existing = groups.get(batch.level) || [];
      existing.push(batch);
      groups.set(batch.level, existing);
    }
    return groups;
  }

  /**
   * 获取指定层级之后的所有未执行调用
   */
  private getRemainingCalls(
    groups: Map<number, ScheduledBatch[]>,
    currentLevel: number,
  ): Array<{ id: string; params: { tool_name: string } }> {
    const remaining: Array<{ id: string; params: { tool_name: string } }> = [];
    for (const [level, levelBatches] of groups) {
      if (level <= currentLevel) continue;
      for (const batch of levelBatches) {
        for (const call of batch.calls) {
          remaining.push(call);
        }
      }
    }
    return remaining;
  }

  /**
   * 执行单个 Batch
   */
  private async executeSingleBatch(
    batch: ScheduledBatch,
    dispatcher: IToolDispatcher,
    workspaceId: string,
    options: CollectOptions,
    abortSignal?: AbortSignal,
  ): Promise<{ results: Array<{ id: string; toolName?: string; success: boolean; data?: Record<string, unknown>; error?: string; errorCode?: string; durationMs: number }> }> {
    // 使用带超时的 Promise.race
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Batch Level ${batch.level} 全局超时 (${options.globalTimeoutMs}ms)`));
      }, options.globalTimeoutMs);
    });

    try {
      const result = await Promise.race([
        dispatcher.executeBatch(batch, workspaceId),
        timeoutPromise,
      ]);
      return result;
    } catch (err) {
      // Batch 级超时或异常
      return {
        results: batch.calls.map((call) => ({
          id: call.id,
          toolName: call.params.tool_name,
          success: false,
          error: err instanceof Error ? err.message : 'Batch 执行异常',
          durationMs: 0,
        })),
      };
    }
  }
}

/**
 * 辅助：Promise.race 的 polyfill（给不使用 Promise.race 的情况）
 */
export { sleep };