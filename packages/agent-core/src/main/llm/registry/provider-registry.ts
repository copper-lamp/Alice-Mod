/**
 * ProviderRegistry — Provider 注册管理器
 *
 * 管理所有 Provider 实例的注册、获取、注销、生命周期管理。
 * 支持单例模式，整个应用共享一个注册表。
 */

import type { LLMProvider, IProviderRegistry, HealthCheckResult } from '../types';

/**
 * Provider 注册管理器实现
 */
export class ProviderRegistry implements IProviderRegistry {
  private static instance: ProviderRegistry;
  private providers: Map<string, LLMProvider> = new Map();

  private constructor() {
    // 私有构造函数，强制使用单例
  }

  /** 获取单例实例 */
  static getInstance(): ProviderRegistry {
    if (!ProviderRegistry.instance) {
      ProviderRegistry.instance = new ProviderRegistry();
    }
    return ProviderRegistry.instance;
  }

  /** 注册一个 Provider */
  register(id: string, provider: LLMProvider): void {
    if (this.providers.has(id)) {
      throw new Error(`Provider '${id}' is already registered`);
    }
    this.providers.set(id, provider);
  }

  /** 获取已注册的 Provider */
  get(id: string): LLMProvider | undefined {
    return this.providers.get(id);
  }

  /** 获取所有已注册的 Provider */
  getAll(): Map<string, LLMProvider> {
    return new Map(this.providers);
  }

  /** 获取所有可用 Provider（healthCheck 通过的） */
  async getAvailable(): Promise<Array<{ id: string; provider: LLMProvider; latencyMs: number }>> {
    const results: Array<{ id: string; provider: LLMProvider; latencyMs: number }> = [];
    const checks: Array<Promise<void>> = [];

    for (const [id, provider] of this.providers) {
      checks.push(
        provider.healthCheck().then(result => {
          if (result.available) {
            results.push({ id, provider, latencyMs: result.latencyMs });
          }
        }).catch(() => {
          // healthCheck 失败不加入可用列表
        }),
      );
    }

    await Promise.all(checks);
    return results.sort((a, b) => a.latencyMs - b.latencyMs);
  }

  /** 注销 Provider */
  unregister(id: string): void {
    if (!this.providers.has(id)) {
      throw new Error(`Provider '${id}' is not registered`);
    }
    this.providers.delete(id);
  }

  /** 检查 Provider 是否已注册 */
  has(id: string): boolean {
    return this.providers.has(id);
  }

  /** 聚合 healthCheck */
  async aggregateHealthCheck(): Promise<Record<string, HealthCheckResult>> {
    const results: Record<string, HealthCheckResult> = {};
    const checks: Array<Promise<void>> = [];

    for (const [id, provider] of this.providers) {
      checks.push(
        provider.healthCheck().then(result => {
          results[id] = result;
        }).catch(error => {
          results[id] = {
            available: false,
            latencyMs: 0,
            model: '',
            error: error.message,
          };
        }),
      );
    }

    await Promise.all(checks);
    return results;
  }

  /** 获取注册的 Provider 数量 */
  get count(): number {
    return this.providers.size;
  }

  /** 重置（清空所有注册，主要用于测试） */
  reset(): void {
    this.providers.clear();
  }
}

/** 单例快捷引用 */
export const providerRegistry = ProviderRegistry.getInstance();