/**
 * DefaultModelRouter — 模型路由选择器
 *
 * 根据工作区配置、任务类型、可用性自动选择最优模型。
 * 路由优先级：自定义规则 → 工作区路由 → 任务类型路由 → 默认路由 → 降级策略
 */

import type { IModelRouter, IProviderRegistry, RouterContext, ResolvedModel, RouterRule, RouterConfig, RouterStats } from '../types';
import { FallbackHandler } from './fallback-handler';
import { createBuiltinRules } from './router-rules';

export class DefaultModelRouter implements IModelRouter {
  private registry: IProviderRegistry;
  private config: RouterConfig;
  private rules: RouterRule[] = [];
  private fallbackHandler: FallbackHandler;
  private stats: RouterStats = {
    totalResolves: 0,
    routeDistribution: {},
    fallbackCount: 0,
    fallbackReasons: {},
    avgLatencyMs: 0,
  };

  constructor(registry: IProviderRegistry, config: RouterConfig) {
    this.registry = registry;
    this.config = config;
    this.fallbackHandler = new FallbackHandler(registry, config.fallback);
    this.registerBuiltinRules();
  }

  async resolve(context: RouterContext): Promise<ResolvedModel> {
    const startTime = Date.now();
    this.stats.totalResolves++;

    // 0. 优先使用上下文中指定的 Provider（如 qqBotModel 的 providerId）
    if (context.providerId) {
      const provider = this.registry.get(context.providerId);
      if (provider && !this.fallbackHandler.isDegraded(context.providerId)) {
        const resolved: ResolvedModel = {
          providerId: context.providerId,
          model: context.model || provider.metadata.supportedModels[0] || 'default',
          options: {},
        };
        this.updateStats(context.providerId, Date.now() - startTime);
        return resolved;
      }
    }

    // 1. 先尝试自定义规则
    for (const rule of [...this.rules].sort((a, b) => b.priority - a.priority)) {
      if (rule.match(context)) {
        if (rule.target === 'fallback') break; // 'fallback' 表示需要检查降级
        if (rule.target.providerId !== 'fallback') {
          const provider = this.registry.get(rule.target.providerId);
          if (provider && !this.fallbackHandler.isDegraded(rule.target.providerId)) {
            this.updateStats(rule.target.providerId, Date.now() - startTime);
            return rule.target;
          }
        }
      }
    }

    // 2. 工作区指定路由（空字符串也是合法的 workspaceId）
    if (context.workspaceId != null && this.config.workspaces?.[context.workspaceId]) {
      const target = this.config.workspaces[context.workspaceId]!;
      if (!this.fallbackHandler.isDegraded(target.providerId)) {
        this.updateStats(target.providerId, Date.now() - startTime);
        return target;
      }
    }

    // 3. 任务类型路由
    if (context.taskType && this.config.taskTypes?.[context.taskType]) {
      const target = this.config.taskTypes[context.taskType]!;
      if (!this.fallbackHandler.isDegraded(target.providerId)) {
        this.updateStats(target.providerId, Date.now() - startTime);
        return target;
      }
    }

    // 4. 默认路由
    const defaultTarget = this.config.default;
    if (!this.fallbackHandler.isDegraded(defaultTarget.providerId)) {
      this.updateStats(defaultTarget.providerId, Date.now() - startTime);
      return defaultTarget;
    }

    // 5. 降级：从 fallback 列表中选择第一个可用的
    this.stats.fallbackCount++;
    const fallbackResult = await this.fallbackHandler.selectFallback(context);
    this.stats.fallbackReasons['所有主 Provider 不可用'] = (this.stats.fallbackReasons['所有主 Provider 不可用'] || 0) + 1;
    this.updateStats(fallbackResult.providerId, Date.now() - startTime);
    return fallbackResult;
  }

  /**
   * 报告调用结果（成功/失败），用于降级决策
   */
  reportResult(providerId: string, success: boolean, error?: string): void {
    this.fallbackHandler.reportResult(providerId, success, error);
  }

  registerRule(rule: RouterRule): void {
    this.rules.push(rule);
  }

  getConfig(): RouterConfig {
    return { ...this.config, fallback: { ...this.config.fallback } };
  }

  updateConfig(config: Partial<RouterConfig>): void {
    if (config.default) this.config.default = config.default;
    if (config.workspaces) this.config.workspaces = { ...this.config.workspaces, ...config.workspaces };
    if (config.taskTypes) this.config.taskTypes = { ...this.config.taskTypes, ...config.taskTypes };
    if (config.fallback) {
      this.config.fallback = { ...this.config.fallback, ...config.fallback };
      this.fallbackHandler.updateConfig(this.config.fallback);
    }
  }

  getStats(): RouterStats {
    return { ...this.stats };
  }

  /** 获取降级处理器（用于外部查询状态） */
  getFallbackHandler(): FallbackHandler {
    return this.fallbackHandler;
  }

  private registerBuiltinRules(): void {
    const builtinRules = createBuiltinRules(this.registry);
    for (const rule of builtinRules) {
      this.rules.push(rule);
    }
  }

  private updateStats(providerId: string, latencyMs: number): void {
    this.stats.routeDistribution[providerId] = (this.stats.routeDistribution[providerId] || 0) + 1;
    // 平滑平均延迟
    const total = this.stats.totalResolves;
    this.stats.avgLatencyMs = this.stats.avgLatencyMs * (total - 1) / total + latencyMs / total;
  }

  /** 重置状态（主要用于测试） */
  reset(): void {
    this.stats = {
      totalResolves: 0,
      routeDistribution: {},
      fallbackCount: 0,
      fallbackReasons: {},
      avgLatencyMs: 0,
    };
    this.fallbackHandler.reset();
  }
}