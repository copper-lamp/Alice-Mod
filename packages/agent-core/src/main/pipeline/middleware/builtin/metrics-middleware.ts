/**
 * 指标统计中间件
 *
 * 收集管线执行的统计指标：
 * - 工具调用次数
 * - 成功率
 * - 平均耗时
 * - 各阶段耗时分布
 *
 * 指标数据存储在 context.metadata 中，供外部查询。
 */

import type { IPipelineMiddleware, MiddlewareContext } from '../../types';

/**
 * 管线指标
 */
export interface PipelineMetrics {
  /** 管线 ID */
  pipelineId: string;
  /** 工具总数 */
  totalCalls: number;
  /** 成功数 */
  successCount: number;
  /** 失败数 */
  failCount: number;
  /** 跳过的工具数 */
  skipCount: number;
  /** 兜底解决数 */
  fallbackCount: number;
  /** 总耗时（ms） */
  totalDurationMs: number;
  /** 各工具耗时 */
  toolDurations: Record<string, number>;
}

/**
 * 指标统计中间件
 *
 * 记录管线执行的关键指标，存入 metadata 供外部查询。
 */
export class MetricsMiddleware implements IPipelineMiddleware {
  readonly name = 'metrics';

  private startTime = 0;

  async before(context: MiddlewareContext): Promise<MiddlewareContext> {
    this.startTime = Date.now();
    context.metadata._metrics = {
      pipelineId: context.pipelineId,
      startTime: this.startTime,
      toolCalls: context.calls.length,
    };

    return context;
  }

  async after(context: MiddlewareContext): Promise<MiddlewareContext> {
    const results = context.results || [];
    const totalDuration = Date.now() - this.startTime;

    const metrics: PipelineMetrics = {
      pipelineId: context.pipelineId,
      totalCalls: results.length,
      successCount: results.filter((r) => r.success).length,
      failCount: results.filter((r) => !r.success && !r.skipped && !r.cancelled).length,
      skipCount: results.filter((r) => r.skipped || r.cancelled).length,
      fallbackCount: results.filter((r) => r.resolvedByFallback).length,
      totalDurationMs: totalDuration,
      toolDurations: {},
    };

    for (const result of results) {
      if (result.toolName) {
        metrics.toolDurations[result.toolName] = result.durationMs;
      }
    }

    context.metadata._metrics = metrics;

    return context;
  }

  /**
   * 获取指标数据
   */
  static getMetrics(context: MiddlewareContext): PipelineMetrics | undefined {
    return context.metadata._metrics as PipelineMetrics | undefined;
  }
}