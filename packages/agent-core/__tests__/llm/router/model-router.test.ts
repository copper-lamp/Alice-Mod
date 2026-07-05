/**
 * DefaultModelRouter 单元测试
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DefaultModelRouter } from '../../../src/main/llm/router/model-router';
import { ProviderRegistry } from '../../../src/main/llm/registry/provider-registry';
import type { LLMProvider, RouterConfig, RouterContext, HealthCheckResult } from '../../../src/main/llm/types';

function createMockProvider(id: string, available: boolean = true): LLMProvider {
  return {
    metadata: {
      id, displayName: id, supportedModels: ['m1'],
      supportsStreaming: true, supportsFunctionCalling: true,
      supportsEmbedding: false, version: '1.0',
    },
    chat: vi.fn(),
    chatStream: vi.fn() as any,
    healthCheck: vi.fn().mockResolvedValue({ available, latencyMs: 10, model: 'm1' } satisfies HealthCheckResult),
  };
}

describe('DefaultModelRouter', () => {
  let registry: ProviderRegistry;
  let router: DefaultModelRouter;
  let config: RouterConfig;

  beforeEach(() => {
    registry = new ProviderRegistry();
    registry.register('openai', createMockProvider('openai'));
    registry.register('gemini', createMockProvider('gemini'));
    registry.register('claude', createMockProvider('claude'));

    config = {
      default: { providerId: 'openai', model: 'gpt-4o', options: { temperature: 0.7 } },
      workspaces: {
        ws_simple: { providerId: 'gemini', model: 'gemini-2.0-flash', options: {} },
      },
      taskTypes: {
        complex: { providerId: 'claude', model: 'claude-3-5-sonnet', options: { temperature: 0.2 } },
        simple: { providerId: 'openai', model: 'gpt-4o-mini', options: { temperature: 0.3 } },
      },
      fallback: {
        fallbacks: [
          { providerId: 'gemini', model: 'gemini-2.0-flash', options: {} },
          { providerId: 'claude', model: 'claude-3-5-sonnet', options: {} },
        ],
        conditions: { maxConsecutiveFailures: 3, timeoutThreshold: 60000 },
        recoveryCheckIntervalMs: 300000,
      },
    };

    router = new DefaultModelRouter(registry, config);
  });

  afterEach(() => {
    router.reset();
  });

  describe('resolve() - 基础路由', () => {
    it('无特殊匹配时应返回默认路由', async () => {
      const result = await router.resolve({
        workspaceId: 'default',
        requiresTools: false,
        requiresStreaming: false,
      });
      expect(result.providerId).toBe('openai');
      expect(result.model).toBe('gpt-4o');
    });

    it('应支持工作区路由', async () => {
      const ctx: RouterContext = {
        workspaceId: 'ws_simple',
        requiresTools: false,
        requiresStreaming: false,
      };
      const result = await router.resolve(ctx);
      expect(result.providerId).toBe('gemini');
    });

    it('应支持任务类型路由', async () => {
      const ctx: RouterContext = {
        workspaceId: 'default',
        taskType: 'complex',
        requiresTools: false,
        requiresStreaming: false,
      };
      const result = await router.resolve(ctx);
      expect(result.providerId).toBe('claude');
    });

    it('工作区路由优先级高于任务类型路由', async () => {
      const ctx: RouterContext = {
        workspaceId: 'ws_simple',
        taskType: 'complex',
        requiresTools: false,
        requiresStreaming: false,
      };
      const result = await router.resolve(ctx);
      // workspace 匹配，应使用 gemini
      expect(result.providerId).toBe('gemini');
    });
  });

  describe('resolve() - 降级路由', () => {
    it('默认 Provider 降级时应触发 fallback', async () => {
      // 模拟 openai 降级
      router.reportResult('openai', false);
      router.reportResult('openai', false);
      router.reportResult('openai', false);

      const result = await router.resolve({
        workspaceId: 'default',
        requiresTools: false,
        requiresStreaming: false,
      });

      // 应降级到 fallback 列表中的第一个（gemini）
      expect(result.providerId).toBe('gemini');
    });

    it('所有目标不可用时应返回 fallback 列表第一个', async () => {
      // 将所有 provider 降级
      router.reportResult('openai', false);
      router.reportResult('openai', false);
      router.reportResult('openai', false);
      router.reportResult('gemini', false);
      router.reportResult('gemini', false);
      router.reportResult('gemini', false);
      router.reportResult('claude', false);
      router.reportResult('claude', false);
      router.reportResult('claude', false);

      const result = await router.resolve({
        workspaceId: 'default',
        requiresTools: false,
        requiresStreaming: false,
      });

      // 全部降级，selectFallback 返回 fallbacks[0]（gemini）
      expect(result).toBeDefined();
      expect(result.providerId).toBe('gemini');
    });
  });

  describe('resolve() - 路由统计', () => {
    it('应正确统计路由分布', async () => {
      await router.resolve({ workspaceId: 'default', requiresTools: false, requiresStreaming: false });
      await router.resolve({ workspaceId: 'default', taskType: 'simple', requiresTools: false, requiresStreaming: false });
      await router.resolve({ workspaceId: 'default', requiresTools: false, requiresStreaming: false });

      const stats = router.getStats();
      expect(stats.totalResolves).toBe(3);
      // 两次默认路由（openai）+ 一次 simple 任务路由（openai/gpt-4o-mini）
      expect(stats.routeDistribution.openai).toBe(3);
    });
  });

  describe('registerRule()', () => {
    it('自定义规则应优先于其他路由', async () => {
      router.registerRule({
        name: 'always-gemini',
        match: () => true,
        target: { providerId: 'gemini', model: 'gemini-2.0-flash', options: {} },
        priority: 999,
      });

      const result = await router.resolve({
        workspaceId: 'default',
        requiresTools: false,
        requiresStreaming: false,
      });
      expect(result.providerId).toBe('gemini');
    });

    it('规则返回 fallback 应继续后续路由', async () => {
      router.registerRule({
        name: 'check-tools',
        match: () => true,
        target: 'fallback',
        priority: 100,
      });

      // 不降级，应走默认路由
      const result = await router.resolve({
        workspaceId: 'default',
        requiresTools: true,
        requiresStreaming: false,
      });
      expect(result.providerId).toBe('openai');
    });
  });

  describe('updateConfig()', () => {
    it('应支持热更新默认路由', async () => {
      router.updateConfig({
        default: { providerId: 'gemini', model: 'gemini-2.0-flash', options: {} },
      });

      const result = await router.resolve({
        workspaceId: 'default',
        requiresTools: false,
        requiresStreaming: false,
      });
      expect(result.providerId).toBe('gemini');
    });

    it('应支持热更新工作区路由', async () => {
      router.updateConfig({
        workspaces: { default: { providerId: 'claude', model: 'claude-sonnet', options: {} } },
      });

      const result = await router.resolve({
        workspaceId: 'default',
        requiresTools: false,
        requiresStreaming: false,
      });
      expect(result.providerId).toBe('claude');
    });
  });

  describe('getConfig()', () => {
    it('应返回当前配置的副本', () => {
      const retrieved = router.getConfig();
      expect(retrieved.default.providerId).toBe('openai');
    });
  });

  describe('getStats()', () => {
    it('初始统计应为空', () => {
      const stats = router.getStats();
      expect(stats.totalResolves).toBe(0);
      expect(stats.fallbackCount).toBe(0);
    });

    it('降级时应记录 fallback 原因', async () => {
      router.reportResult('openai', false);
      router.reportResult('openai', false);
      router.reportResult('openai', false);

      await router.resolve({ workspaceId: 'default', requiresTools: false, requiresStreaming: false });

      const stats = router.getStats();
      expect(stats.fallbackCount).toBe(1);
      expect(Object.keys(stats.fallbackReasons)).toHaveLength(1);
    });
  });

  describe('reportResult()', () => {
    it('应转发到 FallbackHandler', () => {
      router.reportResult('openai', false);
      router.reportResult('openai', false);
      router.reportResult('openai', false);

      expect(router.getFallbackHandler().isDegraded('openai')).toBe(true);
    });
  });
});