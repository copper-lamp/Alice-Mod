/**
 * V6 LLM 模块集成测试
 *
 * 测试 ProviderRegistry + ModelRouter + LLMObserver 的完整协作流程。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ProviderRegistry } from '../../../src/main/llm/registry/provider-registry';
import { DefaultModelRouter } from '../../../src/main/llm/router/model-router';
import { DefaultLLMObserver } from '../../../src/main/llm/observer/llm-observer';
import { MemoryObserverStore } from '../../../src/main/llm/observer/observer-store';
import { DefaultLLMConfigManager, MemoryStorageAdapter } from '../../../src/main/llm/config/config-manager';
import type { LLMProvider, RouterConfig, LLMResponse, HealthCheckResult } from '../../../src/main/llm/types';

function createMockProvider(id: string, available: boolean = true): LLMProvider {
  return {
    metadata: {
      id, displayName: id, supportedModels: ['m1'],
      supportsStreaming: true, supportsFunctionCalling: true,
      supportsEmbedding: false, version: '1.0',
    },
    chat: vi.fn().mockImplementation(async (_messages, _tools, _options) => ({
      message: { role: 'assistant', content: `Response from ${id}` },
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      model: 'm1', requestId: `req_${id}`, durationMs: 100,
      truncated: false, finishReason: 'stop',
    } satisfies LLMResponse)),
    chatStream: vi.fn() as any,
    healthCheck: vi.fn().mockResolvedValue({ available, latencyMs: 10, model: 'm1' } satisfies HealthCheckResult),
  };
}

describe('V6 集成测试 - 完整工作流', () => {
  let registry: ProviderRegistry;
  let router: DefaultModelRouter;
  let observer: DefaultLLMObserver;
  let config: RouterConfig;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    registry = new ProviderRegistry();
    observer = new DefaultLLMObserver(new MemoryObserverStore(1000));

    registry.register('openai', createMockProvider('openai'));
    registry.register('gemini', createMockProvider('gemini'));
    registry.register('claude', createMockProvider('claude'));

    config = {
      default: { providerId: 'openai', model: 'gpt-4o', options: { temperature: 0.7 } },
      taskTypes: {
        complex: { providerId: 'claude', model: 'sonnet', options: { temperature: 0.2 } },
        simple: { providerId: 'gemini', model: 'flash', options: { temperature: 0.3 } },
      },
      fallback: {
        fallbacks: [
          { providerId: 'gemini', model: 'flash', options: {} },
          { providerId: 'claude', model: 'sonnet', options: {} },
        ],
        conditions: { maxConsecutiveFailures: 3, timeoutThreshold: 60000 },
        recoveryCheckIntervalMs: 300000,
      },
    };

    router = new DefaultModelRouter(registry, config);
  });

  afterEach(() => {
    vi.useRealTimers();
    registry.reset();
    router.reset();
    observer.clear();
  });

  it('完整流程：路由选择 → Provider 调用 → Observer 记录', async () => {
    // Step 1: 路由选择
    const resolved = await router.resolve({
      workspaceId: 'default',
      requiresTools: false,
      requiresStreaming: false,
    });

    expect(resolved.providerId).toBe('openai');

    // Step 2: 获取 Provider 并调用
    const provider = registry.get(resolved.providerId)!;
    const response = await observer.wrap(resolved.providerId, resolved.model, async () => {
      return provider.chat([{ role: 'user', content: 'Hello' }]);
    });

    // Step 3: 验证调用结果
    expect(response.message.content).toBe('Response from openai');

    // Step 4: 验证 Observer 记录
    const records = observer.query();
    expect(records).toHaveLength(1);
    expect(records[0].providerId).toBe('openai');
    expect(records[0].success).toBe(true);
    expect(records[0].totalTokens).toBe(30);
  });

  it('完整流程：任务类型路由 → 降级 → Observer 记录错误', async () => {
    // 复杂任务路由到 claude
    const resolved1 = await router.resolve({
      workspaceId: 'default',
      taskType: 'complex',
      requiresTools: false,
      requiresStreaming: false,
    });

    expect(resolved1.providerId).toBe('claude');

    // 模拟 claude 连续失败触发降级
    router.reportResult('claude', false);
    router.reportResult('claude', false);
    router.reportResult('claude', false);

    // 此时复杂任务（claude）已降级，会 fallthrough 到默认路由（openai）
    const resolved2 = await router.resolve({
      workspaceId: 'default',
      taskType: 'complex',
      requiresTools: false,
      requiresStreaming: false,
    });

    expect(resolved2.providerId).toBe('openai'); // 默认路由

    // 通过 observer 记录一次失败调用
    await expect(
      observer.wrap('claude', 'sonnet', async () => {
        throw new Error('API unavailable');
      }),
    ).rejects.toThrow('API unavailable');

    // 验证统计
    const stats = observer.getStats();
    expect(stats.totalCalls).toBe(1);
    expect(stats.successRate).toBe(0);
    expect(stats.byProvider.claude.callCount).toBe(1);
  });

  it('完整流程：ConfigManager + Router 协作', async () => {
    const storage = new MemoryStorageAdapter();
    const configManager = new DefaultLLMConfigManager(storage);

    // 通过 ConfigManager 更新路由配置
    await configManager.updateRouterConfig({
      default: { providerId: 'gemini', model: 'gemini-2.0-flash', options: {} },
    });

    // 读取更新后的配置
    const updatedConfig = await configManager.getRouterConfig();
    expect(updatedConfig.default.providerId).toBe('gemini');

    // 应用配置到 Router
    router.updateConfig(updatedConfig);

    const resolved = await router.resolve({
      workspaceId: 'default',
      requiresTools: false,
      requiresStreaming: false,
    });

    expect(resolved.providerId).toBe('gemini');
  });

  it('完整流程：路由统计和观测聚合', async () => {
    // 执行 5 次调用
    const calls = [
      { workspaceId: 'default', taskType: 'complex' as const },
      { workspaceId: 'default', taskType: 'simple' as const },
      { workspaceId: 'default' },
      { workspaceId: 'default', taskType: 'complex' as const },
      { workspaceId: 'default', taskType: 'simple' as const },
    ];

    for (const call of calls) {
      const resolved = await router.resolve({
        ...call,
        requiresTools: false,
        requiresStreaming: false,
      });
      const provider = registry.get(resolved.providerId)!;
      await observer.wrap(resolved.providerId, resolved.model, async () => {
        return provider.chat([{ role: 'user', content: 'Hi' }]);
      });
    }

    // 验证路由统计
    const routerStats = router.getStats();
    expect(routerStats.totalResolves).toBe(5);
    // complex → claude(2), simple → gemini(2), default → openai(1)
    expect(routerStats.routeDistribution.claude).toBe(2);
    expect(routerStats.routeDistribution.gemini).toBe(2);
    expect(routerStats.routeDistribution.openai).toBe(1);

    // 验证观测统计
    const observerStats = observer.getStats();
    expect(observerStats.totalCalls).toBe(5);
    expect(observerStats.totalTokens).toBe(150); // 5 * 30
    expect(observerStats.successRate).toBe(1);

    // 按 Provider 统计
    expect(observerStats.byProvider.claude.callCount).toBe(2);
    expect(observerStats.byProvider.gemini.callCount).toBe(2);
    expect(observerStats.byProvider.openai.callCount).toBe(1);
  });

  it('完整流程：多个 Provider 注册和健康检查', async () => {
    const extraRegistry = new ProviderRegistry();
    const available: Array<{ id: string; available: boolean }> = [
      { id: 'p1', available: true },
      { id: 'p2', available: true },
      { id: 'p3', available: false },
    ];

    for (const p of available) {
      extraRegistry.register(p.id, createMockProvider(p.id, p.available));
    }

    // 验证 count
    expect(extraRegistry.count).toBe(3);

    // 验证 getAvailable
    const availableProviders = await extraRegistry.getAvailable();
    expect(availableProviders).toHaveLength(2);
    expect(availableProviders.map(a => a.id).sort()).toEqual(['p1', 'p2']);

    // 验证 aggregateHealthCheck
    const healthResults = await extraRegistry.aggregateHealthCheck();
    expect(healthResults.p1.available).toBe(true);
    expect(healthResults.p3.available).toBe(false);

    extraRegistry.reset();
  });

  it('index.ts 导出完整性验证', async () => {
    // 验证所有模块可以从 index 正确导入
    const llmModule = await import('../../../src/main/llm/index');

    // Provider 类
    expect(llmModule.OpenAIProvider).toBeDefined();
    expect(llmModule.ClaudeProvider).toBeDefined();
    expect(llmModule.GeminiProvider).toBeDefined();
    expect(llmModule.OllamaProvider).toBeDefined();

    // 基础类
    expect(llmModule.BaseProvider).toBeDefined();
    expect(llmModule.ProviderError).toBeDefined();

    // 注册管理
    expect(llmModule.ProviderRegistry).toBeDefined();
    expect(llmModule.providerRegistry).toBeDefined();

    // 路由
    expect(llmModule.DefaultModelRouter).toBeDefined();
    expect(llmModule.FallbackHandler).toBeDefined();
    expect(llmModule.createBuiltinRules).toBeDefined();
    expect(llmModule.createTaskTypeRule).toBeDefined();

    // 配置管理
    expect(llmModule.DefaultLLMConfigManager).toBeDefined();
    expect(llmModule.MemoryStorageAdapter).toBeDefined();
    expect(llmModule.LLM_CONFIG_DEFAULTS).toBeDefined();
    expect(llmModule.CONFIG_KEYS).toBeDefined();

    // 观测
    expect(llmModule.DefaultLLMObserver).toBeDefined();
    expect(llmModule.MemoryObserverStore).toBeDefined();

    // 类型
    expect(llmModule.DEFAULT_CHAT_OPTIONS).toBeDefined();
    expect(llmModule.DEFAULT_FALLBACK_STRATEGY).toBeDefined();
    expect(llmModule.DEFAULT_ROUTER_CONFIG).toBeDefined();
    expect(llmModule.BUILTIN_PROVIDERS).toBeDefined();
  });
});