/**
 * FallbackHandler — 降级策略处理器
 */

import type { IProviderRegistry, RouterConfig, ResolvedModel, RouterContext, FallbackStrategy } from '../types';
import { DEFAULT_FALLBACK_STRATEGY } from '../types';

/** 降级状态 */
interface DegradationState {
  /** 连续失败次数 */
  consecutiveFailures: number;
  /** 是否已降级 */
  degraded: boolean;
  /** 降级原因 */
  reason?: string;
  /** 降级时间 */
  degradedAt?: number;
}

/**
 * 降级策略处理器
 * 负责降级决策、状态跟踪、恢复检查
 */
export class FallbackHandler {
  private registry: IProviderRegistry;
  private config: FallbackStrategy;

  /** Provider 降级状态 */
  private states: Map<string, DegradationState> = new Map();

  /** 降级事件历史 */
  private events: Array<{
    providerId: string;
    reason: string;
    timestamp: number;
    resolved: boolean;
  }> = [];

  private recoveryTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private eventLimit = 100;

  constructor(registry: IProviderRegistry, config?: FallbackStrategy) {
    this.registry = registry;
    this.config = config || DEFAULT_FALLBACK_STRATEGY;
  }

  /** 更新降级配置 */
  updateConfig(config: FallbackStrategy): void {
    this.config = config;
  }

  /** 获取当前降级配置 */
  getConfig(): FallbackStrategy {
    return JSON.parse(JSON.stringify(this.config));
  }

  /**
   * 报告调用结果（成功/失败）
   */
  reportResult(providerId: string, success: boolean, error?: string): void {
    const state = this.getOrCreateState(providerId);

    if (success) {
      // 成功后重置计数
      state.consecutiveFailures = 0;
      return;
    }

    state.consecutiveFailures++;

    if (state.consecutiveFailures >= this.config.conditions.maxConsecutiveFailures) {
      this.triggerDegradation(providerId, `连续失败 ${state.consecutiveFailures} 次`);
    }
  }

  /**
   * 检查 Provider 是否处于降级状态
   */
  isDegraded(providerId: string): boolean {
    return this.states.get(providerId)?.degraded || false;
  }

  /**
   * 检查是否超时触发降级
   */
  checkTimeout(providerId: string, durationMs: number): boolean {
    if (durationMs >= this.config.conditions.timeoutThreshold) {
      this.triggerDegradation(providerId, `超时 ${durationMs}ms`);
      return true;
    }
    return false;
  }

  /**
   * 从降级列表中选出一个可用的 Provider + 模型
   * 返回第一个 healthCheck 通过的 fallback
   */
  async selectFallback(context: RouterContext): Promise<ResolvedModel> {
    for (const fallback of this.config.fallbacks) {
      if (!this.isDegraded(fallback.providerId)) {
        const provider = this.registry.get(fallback.providerId);
        if (provider) {
          try {
            const health = await provider.healthCheck();
            if (health.available) {
              return fallback;
            }
          } catch {
            // healthCheck 失败，尝试下一个
          }
        }
      }
    }

    // 所有 fallback 都不可用，返回第一个作为最后尝试
    return this.config.fallbacks[0]!;
  }

  /**
   * 获取降级事件历史
   */
  getEvents(): Array<{ providerId: string; reason: string; timestamp: number; resolved: boolean }> {
    return [...this.events];
  }

  /**
   * 获取降级统计
   */
  getStats(): { totalDegradations: number; activeDegradations: number; currentStates: Record<string, boolean> } {
    const currentStates: Record<string, boolean> = {};
    let activeCount = 0;

    for (const [id, state] of this.states) {
      currentStates[id] = state.degraded;
      if (state.degraded) activeCount++;
    }

    return {
      totalDegradations: this.events.length,
      activeDegradations: activeCount,
      currentStates,
    };
  }

  private getOrCreateState(providerId: string): DegradationState {
    if (!this.states.has(providerId)) {
      this.states.set(providerId, { consecutiveFailures: 0, degraded: false });
    }
    return this.states.get(providerId)!;
  }

  private triggerDegradation(providerId: string, reason: string): void {
    const state = this.getOrCreateState(providerId);
    if (state.degraded) return; // 已在降级状态，不再重复触发

    state.degraded = true;
    state.reason = reason;
    state.degradedAt = Date.now();

    this.events.push({
      providerId,
      reason,
      timestamp: Date.now(),
      resolved: false,
    });

    // 限制事件数量
    if (this.events.length > this.eventLimit) {
      this.events = this.events.slice(-this.eventLimit);
    }

    // 设置恢复检查定时器
    this.scheduleRecoveryCheck(providerId);
  }

  private scheduleRecoveryCheck(providerId: string): void {
    // 清除旧定时器
    if (this.recoveryTimers.has(providerId)) {
      clearTimeout(this.recoveryTimers.get(providerId)!);
    }

    const timer = setTimeout(async () => {
      const provider = this.registry.get(providerId);
      if (provider) {
        try {
          const health = await provider.healthCheck();
          if (health.available) {
            // 恢复
            const state = this.getOrCreateState(providerId);
            state.degraded = false;
            state.consecutiveFailures = 0;
            state.reason = undefined;

            this.events.push({
              providerId,
              reason: '恢复可用',
              timestamp: Date.now(),
              resolved: true,
            });
          } else {
            // 仍未恢复，再次调度
            this.scheduleRecoveryCheck(providerId);
          }
        } catch {
          this.scheduleRecoveryCheck(providerId);
        }
      }
    }, this.config.recoveryCheckIntervalMs);

    this.recoveryTimers.set(providerId, timer);
  }

  /** 重置降级状态（主要用于测试） */
  reset(): void {
    this.states.clear();
    this.events = [];
    for (const timer of this.recoveryTimers.values()) {
      clearTimeout(timer);
    }
    this.recoveryTimers.clear();
  }
}