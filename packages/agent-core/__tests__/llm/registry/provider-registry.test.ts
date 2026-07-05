/**
 * ProviderRegistry 单元测试
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ProviderRegistry } from '../../../src/main/llm/registry/provider-registry';
import type { LLMProvider, ProviderMetadata, LLMResponse, LLMChunk, Message, ChatOptions, ToolDefinition, HealthCheckResult } from '../../../src/main/llm/types';

function createMockProvider(id: string, available: boolean = true, latencyMs: number = 10): LLMProvider {
  const mockProvider: LLMProvider = {
    metadata: {
      id,
      displayName: id,
      supportedModels: ['model-1'],
      supportsStreaming: true,
      supportsFunctionCalling: true,
      supportsEmbedding: false,
      version: '1.0',
    },
    chat: vi.fn().mockResolvedValue({
      message: { role: 'assistant', content: 'ok' },
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      model: 'model-1', requestId: '', durationMs: 0,
      truncated: false, finishReason: 'stop',
    } satisfies LLMResponse),
    chatStream: vi.fn().mockImplementation(async function* () {
      yield { content: 'ok', isLast: true, finishReason: 'stop' } satisfies LLMChunk;
    }),
    healthCheck: vi.fn().mockResolvedValue({
      available,
      latencyMs,
      model: 'model-1',
    } satisfies HealthCheckResult),
  };
  return mockProvider;
}

describe('ProviderRegistry', () => {
  let registry: ProviderRegistry;

  beforeEach(() => {
    registry = new ProviderRegistry();
  });

  afterEach(() => {
    registry.reset();
  });

  describe('register()', () => {
    it('应成功注册 Provider', () => {
      const provider = createMockProvider('test');
      registry.register('test', provider);
      expect(registry.has('test')).toBe(true);
      expect(registry.count).toBe(1);
    });

    it('重复注册应抛出错误', () => {
      const provider = createMockProvider('test');
      registry.register('test', provider);
      expect(() => registry.register('test', provider)).toThrow("Provider 'test' is already registered");
    });

    it('应支持注册多个 Provider', () => {
      registry.register('p1', createMockProvider('p1'));
      registry.register('p2', createMockProvider('p2'));
      expect(registry.count).toBe(2);
    });
  });

  describe('get()', () => {
    it('应返回已注册的 Provider', () => {
      const provider = createMockProvider('test');
      registry.register('test', provider);
      expect(registry.get('test')).toBe(provider);
    });

    it('未注册应返回 undefined', () => {
      expect(registry.get('nonexistent')).toBeUndefined();
    });
  });

  describe('getAll()', () => {
    it('应返回所有注册的 Provider 的 Map 副本', () => {
      registry.register('p1', createMockProvider('p1'));
      registry.register('p2', createMockProvider('p2'));

      const all = registry.getAll();
      expect(all.size).toBe(2);
      expect(all.has('p1')).toBe(true);
      expect(all.has('p2')).toBe(true);

      // 验证返回的是副本
      all.delete('p1');
      expect(registry.has('p1')).toBe(true);
    });
  });

  describe('has()', () => {
    it('已注册应返回 true', () => {
      registry.register('test', createMockProvider('test'));
      expect(registry.has('test')).toBe(true);
    });

    it('未注册应返回 false', () => {
      expect(registry.has('nonexistent')).toBe(false);
    });
  });

  describe('unregister()', () => {
    it('应成功注销 Provider', () => {
      registry.register('test', createMockProvider('test'));
      registry.unregister('test');
      expect(registry.has('test')).toBe(false);
      expect(registry.count).toBe(0);
    });

    it('注销不存在的 Provider 应抛出错误', () => {
      expect(() => registry.unregister('nonexistent')).toThrow("Provider 'nonexistent' is not registered");
    });
  });

  describe('getAvailable()', () => {
    it('应返回所有可用的 Provider（按延迟排序）', async () => {
      const p1 = createMockProvider('fast', true, 5);
      const p2 = createMockProvider('slow', true, 100);
      const p3 = createMockProvider('unavailable', false, 0);

      registry.register('fast', p1);
      registry.register('slow', p2);
      registry.register('unavailable', p3);

      const available = await registry.getAvailable();
      expect(available).toHaveLength(2);
      expect(available[0].id).toBe('fast'); // 延迟低的排前面
      expect(available[1].id).toBe('slow');
    });

    it('全部不可用时返回空数组', async () => {
      registry.register('bad', createMockProvider('bad', false));
      const available = await registry.getAvailable();
      expect(available).toHaveLength(0);
    });

    it('healthCheck 异常不应影响整体结果', async () => {
      const badProvider = createMockProvider('bad', true);
      badProvider.healthCheck = vi.fn().mockRejectedValue(new Error('Network error'));

      registry.register('good', createMockProvider('good', true));
      registry.register('bad', badProvider);

      const available = await registry.getAvailable();
      expect(available).toHaveLength(1);
      expect(available[0].id).toBe('good');
    });
  });

  describe('aggregateHealthCheck()', () => {
    it('应返回所有 Provider 的健康检查结果', async () => {
      registry.register('p1', createMockProvider('p1', true, 10));
      registry.register('p2', createMockProvider('p2', false, 0));

      const results = await registry.aggregateHealthCheck();
      expect(results.p1.available).toBe(true);
      expect(results.p2.available).toBe(false);
    });

    it('异常情况应记录到结果中', async () => {
      const badProvider = createMockProvider('bad', true);
      badProvider.healthCheck = vi.fn().mockRejectedValue(new Error('Connection timeout'));

      registry.register('bad', badProvider);

      const results = await registry.aggregateHealthCheck();
      expect(results.bad.available).toBe(false);
      expect(results.bad.error).toBe('Connection timeout');
    });
  });

  describe('count', () => {
    it('空注册表应返回 0', () => {
      expect(registry.count).toBe(0);
    });

    it('注册后应返回正确数量', () => {
      registry.register('p1', createMockProvider('p1'));
      expect(registry.count).toBe(1);
      registry.register('p2', createMockProvider('p2'));
      expect(registry.count).toBe(2);
    });
  });

  describe('reset()', () => {
    it('应清空所有注册', () => {
      registry.register('p1', createMockProvider('p1'));
      registry.register('p2', createMockProvider('p2'));
      registry.reset();
      expect(registry.count).toBe(0);
      expect(registry.has('p1')).toBe(false);
    });
  });
});