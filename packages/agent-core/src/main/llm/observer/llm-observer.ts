/**
 * DefaultLLMObserver — LLM 调用观测器
 *
 * 记录每次 LLM 调用的 tokens 消耗、耗时、模型名称等关键指标。
 * 支持查询过滤、聚合统计、事件监听、导出。
 */

import type { ILLMObserver, LLMCallRecord, CallRecordFilter, CallStats, ProviderCallStats, ModelCallStats, LLMResponse } from '../types';
import { IObserverStore, MemoryObserverStore } from './observer-store';

export class DefaultLLMObserver implements ILLMObserver {
  private store: IObserverStore;
  private listeners: Array<(record: LLMCallRecord) => void> = [];
  private recordCounter: number = 0;

  constructor(store?: IObserverStore) {
    this.store = store || new MemoryObserverStore();
  }

  async wrap<T>(providerId: string, model: string, call: () => Promise<T>): Promise<T> {
    const startTime = Date.now();
    const requestId = `llm_${providerId}_${++this.recordCounter}_${Date.now()}`;

    try {
      const result = await call();
      const durationMs = Date.now() - startTime;

      // 尝试从结果中提取 usage 信息
      const response = result as LLMResponse | undefined;
      this.record({
        requestId,
        providerId,
        model,
        promptTokens: response?.usage?.promptTokens || 0,
        completionTokens: response?.usage?.completionTokens || 0,
        totalTokens: response?.usage?.totalTokens || 0,
        cachedTokens: response?.usage?.cachedTokens,
        durationMs,
        success: true,
        finishReason: response?.finishReason || 'stop',
        timestamp: Date.now(),
      });

      return result;
    } catch (error: unknown) {
      const durationMs = Date.now() - startTime;
      this.record({
        requestId,
        providerId,
        model,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        durationMs,
        success: false,
        finishReason: 'error',
        error: (error as Error).message,
        timestamp: Date.now(),
      });
      throw error;
    }
  }

  record(callRecord: LLMCallRecord): void {
    this.store.push(callRecord);

    // 通知监听器
    for (const listener of this.listeners) {
      try {
        listener(callRecord);
      } catch {
        // 监听器异常不影响正常流程
      }
    }
  }

  query(filter?: CallRecordFilter): LLMCallRecord[] {
    return this.store.query(filter);
  }

  getStats(timeRange?: { start: number; end: number }): CallStats {
    let filtered = this.store.getAll();
    if (timeRange) {
      filtered = filtered.filter(r =>
        r.timestamp >= timeRange.start && r.timestamp <= timeRange.end,
      );
    }

    const totalCalls = filtered.length;
    if (totalCalls === 0) {
      return {
        totalCalls: 0, totalTokens: 0, totalPromptTokens: 0,
        totalCompletionTokens: 0, totalCachedTokens: 0,
        avgDurationMs: 0, successRate: 1,
        byProvider: {}, byModel: {},
      };
    }

    const byProvider: Record<string, ProviderCallStats> = {};
    const byModel: Record<string, ModelCallStats> = {};

    for (const record of filtered) {
      // 按 Provider 统计
      if (!byProvider[record.providerId]) {
        byProvider[record.providerId] = { callCount: 0, totalTokens: 0, avgDurationMs: 0, successRate: 0 };
      }
      const ps = byProvider[record.providerId]!;
      ps.callCount++;
      ps.totalTokens += record.totalTokens;
      ps.avgDurationMs = ps.avgDurationMs * (ps.callCount - 1) / ps.callCount + record.durationMs / ps.callCount;
      ps.successRate = ps.successRate * (ps.callCount - 1) / ps.callCount + (record.success ? 1 : 0) / ps.callCount;

      // 按模型统计
      if (!byModel[record.model]) {
        byModel[record.model] = { callCount: 0, totalTokens: 0, avgDurationMs: 0, successRate: 0 };
      }
      const ms = byModel[record.model]!;
      ms.callCount++;
      ms.totalTokens += record.totalTokens;
      ms.avgDurationMs = ms.avgDurationMs * (ms.callCount - 1) / ms.callCount + record.durationMs / ms.callCount;
      ms.successRate = ms.successRate * (ms.callCount - 1) / ms.callCount + (record.success ? 1 : 0) / ms.callCount;
    }

    const totalSuccess = filtered.filter(r => r.success).length;

    return {
      totalCalls,
      totalTokens: filtered.reduce((s, r) => s + r.totalTokens, 0),
      totalPromptTokens: filtered.reduce((s, r) => s + r.promptTokens, 0),
      totalCompletionTokens: filtered.reduce((s, r) => s + r.completionTokens, 0),
      totalCachedTokens: filtered.reduce((s, r) => s + (r.cachedTokens || 0), 0),
      avgDurationMs: filtered.reduce((s, r) => s + r.durationMs, 0) / totalCalls,
      successRate: totalSuccess / totalCalls,
      byProvider,
      byModel,
    };
  }

  export(): LLMCallRecord[] {
    return this.store.getAll();
  }

  onCallRecorded(callback: (record: LLMCallRecord) => void): void {
    this.listeners.push(callback);
  }

  /** 获取当前记录数 */
  get recordCount(): number {
    return this.store.length;
  }

  /** 清空所有记录 */
  clear(): void {
    this.store.clear();
  }
}

// ════════════════════════════════════════════════════════════════
// 全局单例
// ════════════════════════════════════════════════════════════════

let observerInstance: DefaultLLMObserver | null = null

/**
 * 获取全局 LLM 调用观测器实例
 * 如果尚未创建，会使用 MemoryObserverStore 自动创建一个。
 */
export function getLLMObserver(): DefaultLLMObserver {
  if (!observerInstance) {
    observerInstance = new DefaultLLMObserver()
  }
  return observerInstance
}

/**
 * 设置全局 LLM 调用观测器实例（通常在主进程初始化时注入 SqliteObserverStore 版本）
 */
export function setLLMObserver(observer: DefaultLLMObserver): void {
  observerInstance = observer
}

/**
 * 重置全局观测器实例（主要用于测试）
 */
export function resetLLMObserver(): void {
  observerInstance = null
}