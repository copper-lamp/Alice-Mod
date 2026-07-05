/**
 * V6 类型定义测试
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CHAT_OPTIONS,
  DEFAULT_FALLBACK_STRATEGY,
  DEFAULT_ROUTER_CONFIG,
  BUILTIN_PROVIDERS,
} from '../../src/main/llm/types';
import type {
  Message, AssistantMessage, ToolCallContent, TextContent, ImageContent,
  ProviderMetadata, ChatOptions, TokenUsage, LLMResponse, LLMChunk,
  HealthCheckResult, RouterContext, ResolvedModel, RouterRule,
  RouterConfig, FallbackStrategy, RouterStats, ProviderConfig,
  ConfigChangeEvent, LLMCallRecord, CallRecordFilter,
  ProviderCallStats, ModelCallStats, CallStats,
  ToolDefinition, SchemaProperty, LLMProvider,
  IProviderRegistry, IModelRouter, ILLMConfigManager, ILLMObserver,
} from '../../src/main/llm/types';

describe('V6 类型定义 - 消息类型', () => {
  it('Message 接口应正确初始化', () => {
    const msg: Message = { role: 'user', content: 'hello' };
    expect(msg.role).toBe('user');
    expect(msg.content).toBe('hello');
  });

  it('AssistantMessage 应支持 tool_calls', () => {
    const tc: ToolCallContent = {
      type: 'tool_call',
      toolCallId: 'call_1',
      toolName: 'get_weather',
      arguments: { city: 'Beijing' },
    };
    const msg: AssistantMessage = { role: 'assistant', content: '', tool_calls: [tc] };
    expect(msg.tool_calls).toHaveLength(1);
    expect(msg.tool_calls![0].toolName).toBe('get_weather');
  });

  it('MessageContent 支持 text 和 image', () => {
    const text: TextContent = { type: 'text', text: 'desc' };
    const img: ImageContent = { type: 'image', data: 'abc123', mimeType: 'image/png' };
    expect(text.text).toBe('desc');
    expect(img.mimeType).toBe('image/png');
  });

  it('ToolCallContent 应正确构造', () => {
    const tc: ToolCallContent = {
      type: 'tool_call',
      toolCallId: 'tc_1',
      toolName: 'search',
      arguments: { q: 'test' },
    };
    expect(tc.type).toBe('tool_call');
    expect(tc.arguments.q).toBe('test');
  });
});

describe('V6 类型定义 - Provider 接口', () => {
  it('ProviderMetadata 应包含所有必需字段', () => {
    const meta: ProviderMetadata = {
      id: 'test', displayName: 'Test', supportedModels: ['m1'],
      supportsStreaming: true, supportsFunctionCalling: true,
      supportsEmbedding: false, version: '1.0',
    };
    expect(meta.id).toBe('test');
    expect(meta.supportsStreaming).toBe(true);
  });
});

describe('V6 类型定义 - 响应类型', () => {
  it('LLMResponse 应包含完整字段', () => {
    const resp: LLMResponse = {
      message: { role: 'assistant', content: 'ok' },
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      model: 'gpt-4o', requestId: 'req_1', durationMs: 100,
      truncated: false, finishReason: 'stop',
    };
    expect(resp.model).toBe('gpt-4o');
    expect(resp.usage.totalTokens).toBe(30);
  });

  it('LLMChunk 应支持流式字段', () => {
    const chunk: LLMChunk = { content: 'hello', isLast: true, finishReason: 'stop' };
    expect(chunk.content).toBe('hello');
    expect(chunk.isLast).toBe(true);
  });

  it('TokenUsage 应支持可选 cachedTokens', () => {
    const usage: TokenUsage = { promptTokens: 1, completionTokens: 2, totalTokens: 3, cachedTokens: 5 };
    expect(usage.cachedTokens).toBe(5);
  });

  it('HealthCheckResult 应包含 latencyMs', () => {
    const hc: HealthCheckResult = { available: true, latencyMs: 42, model: 'm1' };
    expect(hc.latencyMs).toBe(42);
    expect(hc.available).toBe(true);
  });
});

describe('V6 类型定义 - 路由类型', () => {
  it('RouterContext 应包含工作区和任务类型', () => {
    const ctx: RouterContext = {
      workspaceId: 'ws1', taskType: 'complex',
      estimatedTokens: 5000, requiresTools: true, requiresStreaming: false,
    };
    expect(ctx.workspaceId).toBe('ws1');
    expect(ctx.requiresTools).toBe(true);
  });

  it('ResolvedModel 应包含 providerId 和 model', () => {
    const rm: ResolvedModel = { providerId: 'openai', model: 'gpt-4o', options: {} };
    expect(rm.providerId).toBe('openai');
    expect(rm.model).toBe('gpt-4o');
  });

  it('RouterRule 应包含匹配函数和目标', () => {
    const rule: RouterRule = {
      name: 'test-rule',
      match: (ctx) => ctx.taskType === 'simple',
      target: { providerId: 'openai', model: 'gpt-4o-mini', options: {} },
      priority: 50,
    };
    expect(rule.name).toBe('test-rule');
    expect(rule.match({ workspaceId: '', requiresTools: false, requiresStreaming: false })).toBe(false);
    expect(rule.match({ workspaceId: '', taskType: 'simple', requiresTools: false, requiresStreaming: false })).toBe(true);
  });

  it('RouterConfig 应包含默认和降级策略', () => {
    const config: RouterConfig = {
      default: { providerId: 'openai', model: 'gpt-4o', options: {} },
      fallback: {
        fallbacks: [],
        conditions: { maxConsecutiveFailures: 3, timeoutThreshold: 60000 },
        recoveryCheckIntervalMs: 300000,
      },
    };
    expect(config.default.providerId).toBe('openai');
    expect(config.fallback.conditions.maxConsecutiveFailures).toBe(3);
  });

  it('RouterStats 应包含分布和降级计数', () => {
    const stats: RouterStats = {
      totalResolves: 10, routeDistribution: { openai: 8 },
      fallbackCount: 2, fallbackReasons: { timeout: 2 }, avgLatencyMs: 150,
    };
    expect(stats.totalResolves).toBe(10);
    expect(stats.fallbackCount).toBe(2);
  });
});

describe('V6 类型定义 - 配置类型', () => {
  it('ProviderConfig 应包含 API 配置', () => {
    const config: ProviderConfig = {
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-xxx',
      defaultModel: 'gpt-4o',
      timeout: 30000, maxRetries: 3,
    };
    expect(config.baseUrl).toBe('https://api.openai.com/v1');
    expect(config.maxRetries).toBe(3);
  });

  it('ConfigChangeEvent 应包含类型和时间戳', () => {
    const event: ConfigChangeEvent = { type: 'provider_updated', providerId: 'openai', timestamp: 1000 };
    expect(event.type).toBe('provider_updated');
    expect(event.timestamp).toBe(1000);
  });

  it('FallbackStrategy 应包含降级顺序和条件', () => {
    const strategy: FallbackStrategy = {
      fallbacks: [{ providerId: 'ollama', model: 'qwen2.5:7b', options: {} }],
      conditions: { maxConsecutiveFailures: 3, timeoutThreshold: 120000 },
      recoveryCheckIntervalMs: 300000,
    };
    expect(strategy.fallbacks).toHaveLength(1);
    expect(strategy.conditions.timeoutThreshold).toBe(120000);
  });
});

describe('V6 类型定义 - 观测类型', () => {
  it('LLMCallRecord 应包含完整调用信息', () => {
    const record: LLMCallRecord = {
      requestId: 'r1', providerId: 'openai', model: 'gpt-4o',
      promptTokens: 10, completionTokens: 20, totalTokens: 30,
      durationMs: 100, success: true, finishReason: 'stop',
      timestamp: 1000,
    };
    expect(record.totalTokens).toBe(30);
    expect(record.success).toBe(true);
  });

  it('CallRecordFilter 应支持多条件筛选', () => {
    const filter: CallRecordFilter = {
      providerId: 'openai', model: 'gpt-4o', success: true,
      startTime: 0, endTime: 2000, limit: 10, offset: 0,
    };
    expect(filter.providerId).toBe('openai');
    expect(filter.limit).toBe(10);
  });

  it('CallStats 应包含聚合数据', () => {
    const stats: CallStats = {
      totalCalls: 5, totalTokens: 100,
      totalPromptTokens: 40, totalCompletionTokens: 60, totalCachedTokens: 10,
      avgDurationMs: 200, successRate: 0.8,
      byProvider: {}, byModel: {},
    };
    expect(stats.totalCalls).toBe(5);
    expect(stats.successRate).toBe(0.8);
  });

  it('ProviderCallStats 应包含 provider 维度统计', () => {
    const ps: ProviderCallStats = { callCount: 5, totalTokens: 100, avgDurationMs: 200, successRate: 0.8 };
    expect(ps.callCount).toBe(5);
    expect(ps.successRate).toBe(0.8);
  });
});

describe('V6 类型定义 - 工具定义', () => {
  it('ToolDefinition 应包含 JSON Schema', () => {
    const prop: SchemaProperty = { type: 'string', description: 'city name' };
    const tool: ToolDefinition = {
      name: 'get_weather',
      description: 'Get weather',
      input_schema: { type: 'object', properties: { city: prop }, required: ['city'] },
    };
    expect(tool.name).toBe('get_weather');
    expect(tool.input_schema.required).toContain('city');
  });
});

describe('V6 类型定义 - 常量', () => {
  it('BUILTIN_PROVIDERS 应包含 4 个内置 Provider', () => {
    expect(BUILTIN_PROVIDERS.OPENAI).toBe('openai');
    expect(BUILTIN_PROVIDERS.CLAUDE).toBe('claude');
    expect(BUILTIN_PROVIDERS.GEMINI).toBe('gemini');
    expect(BUILTIN_PROVIDERS.OLLAMA).toBe('ollama');
  });

  it('DEFAULT_CHAT_OPTIONS 应包含默认值', () => {
    expect(DEFAULT_CHAT_OPTIONS.temperature).toBe(0.7);
    expect(DEFAULT_CHAT_OPTIONS.maxTokens).toBe(4096);
    expect(DEFAULT_CHAT_OPTIONS.timeout).toBe(60000);
    expect(DEFAULT_CHAT_OPTIONS.retryCount).toBe(3);
  });

  it('DEFAULT_FALLBACK_STRATEGY 应包含 2 个降级选项', () => {
    expect(DEFAULT_FALLBACK_STRATEGY.fallbacks).toHaveLength(2);
    expect(DEFAULT_FALLBACK_STRATEGY.conditions.maxConsecutiveFailures).toBe(3);
    expect(DEFAULT_FALLBACK_STRATEGY.recoveryCheckIntervalMs).toBe(300000);
  });

  it('DEFAULT_ROUTER_CONFIG 应使用 openai/gpt-4o 作为默认', () => {
    expect(DEFAULT_ROUTER_CONFIG.default.providerId).toBe('openai');
    expect(DEFAULT_ROUTER_CONFIG.default.model).toBe('gpt-4o');
  });
});

describe('V6 类型定义 - 接口结构验证', () => {
  it('LLMProvider 接口应声明所有方法', () => {
    // 验证接口结构（类型检查在编译时进行）
    const methods: (keyof LLMProvider)[] = ['metadata', 'chat', 'chatStream', 'healthCheck'];
    expect(methods).toContain('chat');
    expect(methods).toContain('chatStream');
  });

  it('IProviderRegistry 接口应声明所有方法', () => {
    const methods: (keyof IProviderRegistry)[] = ['register', 'get', 'getAll', 'getAvailable', 'unregister', 'has', 'aggregateHealthCheck'];
    expect(methods).toContain('register');
    expect(methods).toContain('getAvailable');
  });

  it('IModelRouter 接口应声明路由方法', () => {
    const methods: (keyof IModelRouter)[] = ['resolve', 'registerRule', 'getConfig', 'updateConfig', 'getStats', 'reportResult'];
    expect(methods).toContain('resolve');
    expect(methods).toContain('reportResult');
  });

  it('ILLMConfigManager 接口应声明配置方法', () => {
    const methods: (keyof ILLMConfigManager)[] = ['getProviderConfigs', 'updateProviderConfig', 'removeProviderConfig', 'getRouterConfig', 'updateRouterConfig', 'onConfigChanged'];
    expect(methods).toContain('getProviderConfigs');
    expect(methods).toContain('onConfigChanged');
  });

  it('ILLMObserver 接口应声明观测方法', () => {
    const methods: (keyof ILLMObserver)[] = ['wrap', 'record', 'query', 'getStats', 'export', 'onCallRecorded'];
    expect(methods).toContain('wrap');
    expect(methods).toContain('getStats');
  });
});