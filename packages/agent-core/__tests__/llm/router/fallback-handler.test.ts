/**
 * FallbackHandler 单元测试
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FallbackHandler } from '../../../src/main/llm/router/fallback-handler';
import { ProviderRegistry } from '../../../src/main/llm/registry/provider-registry';
import type { LLMProvider, FallbackStrategy, HealthCheckResult } from '../../../src/main/llm/types';

function createMockProvider(available: boolean = true): LLMProvider {
  return {
    metadata: {
      id: 'mock', displayName: 'Mock', supportedModels: ['m1'],
      supportsStreaming: true, supportsFunctionCalling: true,
      supportsEmbedding: false, version: '1.0',
    },
    chat: vi.fn(),
    chatStream: vi.fn() as any,
    healthCheck: vi.fn().mockResolvedValue({ available, latencyMs: 10, model: 'm1' } satisfies HealthCheckResult),
  };
}

describe('FallbackHandler', () => {
  let registry: ProviderRegistry;
  let handler: FallbackHandler;
  let config: FallbackStrategy;

  beforeEach(() => {
    registry = new ProviderRegistry();

    config = {
      fallbacks: [
        { providerId: 'openai', model: 'gpt-4o-mini', options: {} },
        { providerId: 'gemini', model: 'gemini-2.0-flash', options: {} },
        { providerId: 'ollama', model: 'qwen2.5:7b', options: {} },
      ],
      conditions: {
        maxConsecutiveFailures: 3,
        timeoutThreshold: 5000,
      },
      recoveryCheckIntervalMs: 10000,
    };

    handler = new FallbackHandler(registry, config);
  });

  afterEach(() => {
    handler.reset();
  });

  describe('reportResult()', () => {
    it('成功应重置连续失败计数', () => {
      handler.reportResult('openai', false); // fail 1
      handler.reportResult('openai', false); // fail 2
      handler.reportResult('openai', true);  // success
      expect(handler.isDegraded('openai')).toBe(false);
    });

    it('连续失败达到阈值应触发降级', () => {
      handler.reportResult('openai', false); // fail 1
      handler.reportResult('openai', false); // fail 2
      expect(handler.isDegraded('openai')).toBe(false);

      handler.reportResult('openai', false); // fail 3 → degraded
      expect(handler.isDegraded('openai')).toBe(true);
    });

    it('降级后不再重复触发', () => {
      handler.reportResult('openai', false); // fail 1
      handler.reportResult('openai', false); // fail 2
      handler.reportResult('openai', false); // fail 3 → degraded
      handler.reportResult('openai', false); // fail 4 → already degraded, no change

      const stats = handler.getStats();
      expect(stats.totalDegradations).toBe(1);
    });
  });

  describe('isDegraded()', () => {
    it('未降级应返回 false', () => {
      expect(handler.isDegraded('openai')).toBe(false);
    });

    it('降级后应返回 true', () => {
      handler.reportResult('openai', false);
      handler.reportResult('openai', false);
      handler.reportResult('openai', false);
      expect(handler.isDegraded('openai')).toBe(true);
    });

    it('不存在的 Provider 应返回 false', () => {
      expect(handler.isDegraded('nonexistent')).toBe(false);
    });
  });

  describe('checkTimeout()', () => {
    it('未超过阈值不应触发降级', () => {
      handler.checkTimeout('openai', 1000);
      expect(handler.isDegraded('openai')).toBe(false);
    });

    it('超过阈值应触发降级', () => {
      const result = handler.checkTimeout('openai', 6000);
      expect(result).toBe(true);
      expect(handler.isDegraded('openai')).toBe(true);
    });
  });

  describe('selectFallback()', () => {
    it('应返回第一个可用且未降级的 fallback', async () => {
      registry.register('openai', createMockProvider(true));
      registry.register('gemini', createMockProvider(true));

      const result = await handler.selectFallback({ workspaceId: '', requiresTools: false, requiresStreaming: false });
      expect(result.providerId).toBe('openai');
      expect(result.model).toBe('gpt-4o-mini');
    });

    it('应跳过已降级的 fallback', async () => {
      registry.register('openai', createMockProvider(true));
      registry.register('gemini', createMockProvider(true));

      // 将 openai 降级
      handler.reportResult('openai', false);
      handler.reportResult('openai', false);
      handler.reportResult('openai', false);

      const result = await handler.selectFallback({ workspaceId: '', requiresTools: false, requiresStreaming: false });
      expect(result.providerId).toBe('gemini');
    });

    it('所有 fallback 不可用应返回第一个', async () => {
      // 不注册任何 provider
      const result = await handler.selectFallback({ workspaceId: '', requiresTools: false, requiresStreaming: false });
      expect(result.providerId).toBe('openai');
    });
  });

  describe('getEvents()', () => {
    it('无事件时应返回空数组', () => {
      expect(handler.getEvents()).toHaveLength(0);
    });

    it('降级后应包含事件记录', () => {
      handler.reportResult('openai', false);
      handler.reportResult('openai', false);
      handler.reportResult('openai', false);

      const events = handler.getEvents();
      expect(events).toHaveLength(1);
      expect(events[0].providerId).toBe('openai');
      expect(events[0].resolved).toBe(false);
    });
  });

  describe('getStats()', () => {
    it('应返回正确的降级统计', () => {
      handler.reportResult('openai', false);
      handler.reportResult('openai', false);
      handler.reportResult('openai', false);

      const stats = handler.getStats();
      expect(stats.totalDegradations).toBe(1);
      expect(stats.activeDegradations).toBe(1);
      expect(stats.currentStates.openai).toBe(true);
    });

    it('无降级时应返回 0', () => {
      const stats = handler.getStats();
      expect(stats.totalDegradations).toBe(0);
      expect(stats.activeDegradations).toBe(0);
    });
  });

  describe('updateConfig()', () => {
    it('应更新降级配置', () => {
      handler.updateConfig({
        ...config,
        conditions: { maxConsecutiveFailures: 1, timeoutThreshold: 1000 },
      });

      handler.reportResult('openai', false); // 只需 1 次失败就降级
      expect(handler.isDegraded('openai')).toBe(true);
    });
  });

  describe('getConfig()', () => {
    it('应返回当前配置的副本', () => {
      const retrieved = handler.getConfig();
      expect(retrieved.conditions.maxConsecutiveFailures).toBe(3);
      // 验证是副本
      retrieved.conditions.maxConsecutiveFailures = 999;
      expect(handler.getConfig().conditions.maxConsecutiveFailures).toBe(3);
    });
  });

  describe('reset()', () => {
    it('应清空所有降级状态和事件', () => {
      handler.reportResult('openai', false);
      handler.reportResult('openai', false);
      handler.reportResult('openai', false);
      expect(handler.isDegraded('openai')).toBe(true);

      handler.reset();
      expect(handler.isDegraded('openai')).toBe(false);
      expect(handler.getEvents()).toHaveLength(0);
      expect(handler.getStats().totalDegradations).toBe(0);
    });
  });
});