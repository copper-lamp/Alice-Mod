/**
 * V20 §4.1 MainAgent 单元测试
 *
 * 验收覆盖（执行文档 §3.3）：
 * - 基本流程（finishReason='stop' 一次结束）
 * - 工具调用（2 轮：tool_calls → stop）
 * - maxRounds 截断（连续 tool_calls 达上限）
 * - abort 透传（外部 abortSignal 在循环中触发）
 * - Provider 未注册（providerRegistry.get 返回 undefined）
 * - World 离线（pipeline 抛 NotConnectedError）
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AgentConfig } from '../../src/renderer/src/lib/types';
import type { ToolRegistry } from '../../src/main/workspace/tool-registry';
import type { PromptBuilder } from '../../src/main/prompt/builder/prompt-builder';
import type {
  IModelRouter,
  IProviderRegistry,
  ILLMObserver,
  LLMProvider,
  LLMResponse,
  ResolvedModel,
  RouterConfig,
  RouterStats,
  RouterRule,
  ToolDefinition,
} from '../../src/main/llm/types';
import type { FunctionCallingPipeline } from '../../src/main/pipeline/pipeline';
import type { ConnectionResolver } from '../../src/main/agent/connection-resolver';
import type { ChatHistoryStore, ChatHistoryEntry } from '../../src/main/chat-history/chat-history-store';
import type { LlmRequestScheduler } from '../../src/main/llm/scheduler/types';
import type { PipelineResult, Conversation } from '../../src/main/pipeline/types';
import type { PromptBuildResult, ConversationMessage } from '../../src/main/prompt/types';
import { MainAgent } from '../../src/main/agent/main-agent';
import { AbortError, NotConnectedError } from '../../src/main/tcp/errors';

// ═══════════════════════════════════════════════════════════
// Mock 工厂
// ═══════════════════════════════════════════════════════════

function makeAgentConfig(): AgentConfig {
  return {
    id: 'agent-test-01',
    name: 'TestAgent',
    persona: {
      identity: '测试用 Agent',
      expertise: [],
      personality: ['冷静'],
      workflowId: 'explore_gather',
    },
    tools: { enabledTools: {} },
    qqBinding: { enabled: false },
    llmConfig: {
      mainModel: {
        providerId: 'openai',
        modelId: 'gpt-4o',
        modelName: 'gpt-4o',
      },
      qqBotModel: {
        providerId: 'claude',
        modelId: 'claude-3-5-sonnet',
        modelName: 'claude-3-5-sonnet',
      },
      compressionModel: {
        providerId: 'openai',
        modelId: 'gpt-4o-mini',
        modelName: 'gpt-4o-mini',
      },
    },
    isMain: true,
    workspaceId: 'ws-001',
  };
}

function makeResolvedModel(providerId = 'openai', model = 'gpt-4o'): ResolvedModel {
  return {
    providerId,
    model,
    options: { temperature: 0.7, maxTokens: 4096 },
  };
}

function makeLLMResponse(
  finishReason: 'stop' | 'tool_calls' | 'length' | 'error',
  options: {
    content?: string;
    toolCalls?: Array<{ toolCallId: string; toolName: string; arguments: Record<string, unknown> }>;
    totalTokens?: number;
  } = {},
): LLMResponse {
  const content = options.content ?? (finishReason === 'stop' ? '完成' : '');
  return {
    message: {
      role: 'assistant',
      content,
      tool_calls: options.toolCalls,
    },
    usage: {
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: options.totalTokens ?? 15,
    },
    model: 'gpt-4o',
    requestId: 'req-test',
    durationMs: 100,
    truncated: false,
    finishReason,
  };
}

function makePipelineResult(): PipelineResult {
  return {
    toolResults: [
      {
        type: 'tool_result',
        toolCallId: 'call_1',
        toolName: 'move_to',
        success: true,
        data: { ok: true },
        durationMs: 50,
      },
    ],
    totalDurationMs: 60,
    phaseDurations: {
      parse: 1, analyze: 1, schedule: 1,
      middlewareBefore: 0, dispatch: 50, collect: 1,
      fallback: 0, middlewareAfter: 0, inject: 1,
    },
    stats: { total: 1, success: 1, failed: 0, skipped: 0, cancelled: 0, fallbackResolved: 0 },
    hasErrors: false,
    errors: [],
  };
}

function makePromptBuildResult(): PromptBuildResult {
  return {
    messages: [
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'user input' },
    ],
    tools: [],
    cache: {
      key: 'cache-key',
      staticTokens: 10,
      dynamicTokens: 5,
      totalTokens: 15,
      regions: { system: 's', tools: 't', dynamic: 'd' },
    },
    tokenBreakdown: {
      systemPrompt: 5,
      stateInjection: 1,
      toolDefinitions: 0,
      conversationHistory: 0,
      userInput: 2,
      fragments: 0,
      total: 8,
    },
    cacheHit: false,
  };
}

// ═══════════════════════════════════════════════════════════
// Mock 依赖构建器
// ═══════════════════════════════════════════════════════════

interface MockDeps {
  toolRegistry: ToolRegistry;
  promptBuilder: PromptBuilder;
  modelRouter: IModelRouter;
  providerRegistry: IProviderRegistry;
  pipeline: FunctionCallingPipeline;
  connectionResolver: ConnectionResolver;
  historyStore: ChatHistoryStore;
  scheduler: LlmRequestScheduler;
  observer: ILLMObserver;
  providerChatMock: ReturnType<typeof vi.fn>;
  pipelineProcessMock: ReturnType<typeof vi.fn>;
  historyAppendMock: ReturnType<typeof vi.fn>;
  historyLoadMock: ReturnType<typeof vi.fn>;
  routerResolveMock: ReturnType<typeof vi.fn>;
  observerWrapMock: ReturnType<typeof vi.fn>;
}

function buildMocks(): MockDeps {
  const providerChatMock = vi.fn();
  const pipelineProcessMock = vi.fn();
  const historyAppendMock = vi.fn().mockResolvedValue(1);
  const historyLoadMock = vi.fn().mockResolvedValue([] as ChatHistoryEntry[]);
  const routerResolveMock = vi.fn().mockResolvedValue(makeResolvedModel());
  const observerWrapMock = vi.fn();

  const mockProvider: LLMProvider = {
    metadata: {
      id: 'openai',
      displayName: 'OpenAI',
      supportedModels: ['gpt-4o'],
      supportsStreaming: true,
      supportsFunctionCalling: true,
      supportsEmbedding: false,
      version: '1',
    },
    chat: providerChatMock,
    chatStream: async function* () { yield { content: 'x', isLast: true }; },
    healthCheck: async () => ({ available: true, latencyMs: 10, model: 'gpt-4o' }),
  };

  // observer.wrap: 直接调用 fn 并返回结果
  observerWrapMock.mockImplementation(
    async (_pid: string, _model: string, call: () => Promise<unknown>) => call(),
  );

  const deps: MockDeps = {
    toolRegistry: { getTools: () => [] } as unknown as ToolRegistry,
    promptBuilder: {
      build: vi.fn().mockResolvedValue(makePromptBuildResult()),
      updateProfile: vi.fn(),
    } as unknown as PromptBuilder,
    modelRouter: {
      resolve: routerResolveMock,
      registerRule: vi.fn(),
      getConfig: vi.fn().mockReturnValue({ default: makeResolvedModel(), fallback: { fallbacks: [], conditions: { maxConsecutiveFailures: 3, timeoutThreshold: 1000 }, recoveryCheckIntervalMs: 1000 } }),
      updateConfig: vi.fn(),
      getStats: vi.fn().mockReturnValue({ totalResolves: 0, routeDistribution: {}, fallbackCount: 0, fallbackReasons: {}, avgLatencyMs: 0 }),
      reportResult: vi.fn(),
    } as unknown as IModelRouter,
    providerRegistry: {
      get: vi.fn().mockReturnValue(mockProvider),
      has: vi.fn().mockReturnValue(true),
      register: vi.fn(),
      unregister: vi.fn(),
      getAll: vi.fn().mockReturnValue(new Map()),
      getAvailable: vi.fn(),
      aggregateHealthCheck: vi.fn(),
    } as unknown as IProviderRegistry,
    pipeline: {
      process: pipelineProcessMock,
      setDispatcher: vi.fn(),
      setCollector: vi.fn(),
      use: vi.fn(),
      on: vi.fn(),
      emit: vi.fn(),
    } as unknown as FunctionCallingPipeline,
    connectionResolver: {} as ConnectionResolver,
    historyStore: {
      append: historyAppendMock,
      load: historyLoadMock,
      clear: vi.fn(),
      getStats: vi.fn(),
    } as unknown as ChatHistoryStore,
    scheduler: {
      // 透传：直接执行 fn
      schedule: vi.fn().mockImplementation((_req: unknown, fn: () => Promise<unknown>) => fn()),
      setProviderRateLimit: vi.fn(),
      getStatus: vi.fn(),
      on: vi.fn(),
    } as unknown as LlmRequestScheduler,
    observer: {
      wrap: observerWrapMock,
      record: vi.fn(),
      query: vi.fn().mockReturnValue([]),
      getStats: vi.fn(),
      export: vi.fn(),
      onCallRecorded: vi.fn(),
    } as unknown as ILLMObserver,
    providerChatMock,
    pipelineProcessMock,
    historyAppendMock,
    historyLoadMock,
    routerResolveMock,
    observerWrapMock,
  };

  return deps;
}

function buildAgent(deps: MockDeps, opts: { maxRounds?: number; abortSignal?: AbortSignal } = {}) {
  return new MainAgent({
    agentConfig: makeAgentConfig(),
    workspaceId: 'ws-001',
    agentId: 'agent-test-01',
    toolRegistry: deps.toolRegistry,
    promptBuilder: deps.promptBuilder,
    modelRouter: deps.modelRouter,
    providerRegistry: deps.providerRegistry,
    pipeline: deps.pipeline,
    connectionResolver: deps.connectionResolver,
    historyStore: deps.historyStore,
    scheduler: deps.scheduler,
    observer: deps.observer,
    maxRounds: opts.maxRounds,
    abortSignal: opts.abortSignal,
  });
}

// ═══════════════════════════════════════════════════════════
// 测试用例
// ═══════════════════════════════════════════════════════════

describe('MainAgent', () => {
  let deps: MockDeps;

  beforeEach(() => {
    deps = buildMocks();
  });

  // ───────────────────────────────────────────────────────
  // 1. 基本流程（stop）
  // ───────────────────────────────────────────────────────
  describe('基本流程', () => {
    it('finishReason=stop 时单轮结束，返回 finalResponse', async () => {
      deps.providerChatMock.mockResolvedValue(makeLLMResponse('stop', { content: '你好' }));

      const agent = buildAgent(deps);
      const result = await agent.handle({
        source: 'trigger',
        prompt: '打招呼',
      });

      expect(result.error).toBeUndefined();
      expect(result.finalResponse).toBe('你好');
      // rounds 是 for 循环计数器：break 后不自增，单轮 stop 时 rounds=0
      expect(result.rounds).toBe(0);
      expect(result.totalTokens).toBe(15);
      expect(result.truncated).toBe(false);

      // 验证只调了一次 provider.chat
      expect(deps.providerChatMock).toHaveBeenCalledTimes(1);
      // 验证 history.append 被调了一次（assistant 消息）
      expect(deps.historyAppendMock).toHaveBeenCalledTimes(1);
      expect(deps.historyAppendMock.mock.calls[0]![0]).toMatchObject({
        role: 'assistant',
        content: '你好',
        finishReason: 'stop',
      });
      // 验证 pipeline.process 未被调用
      expect(deps.pipelineProcessMock).not.toHaveBeenCalled();
    });

    it('event.source=qq 时选 qqBotModel 而非 mainModel', async () => {
      deps.providerChatMock.mockResolvedValue(makeLLMResponse('stop'));
      deps.routerResolveMock.mockResolvedValue(makeResolvedModel('claude', 'claude-3-5-sonnet'));

      const agent = buildAgent(deps);
      await agent.handle({ source: 'qq', prompt: 'hi' });

      // router 应被调用，且 providerId 来自 qqBotModel
      expect(deps.routerResolveMock).toHaveBeenCalledTimes(1);
      // scheduler.schedule 的 providerId 应为 claude
      const scheduleReq = (deps.scheduler.schedule as ReturnType<typeof vi.fn>).mock.calls[0]![0];
      expect(scheduleReq.providerId).toBe('claude');
    });
  });

  // ───────────────────────────────────────────────────────
  // 2. 工具调用（2 轮）
  // ───────────────────────────────────────────────────────
  describe('工具调用多轮', () => {
    it('第 1 轮 tool_calls → pipeline 处理 → 第 2 轮 stop', async () => {
      deps.providerChatMock
        .mockResolvedValueOnce(makeLLMResponse('tool_calls', {
          toolCalls: [{ toolCallId: 'call_1', toolName: 'move_to', arguments: { x: 1 } }],
        }))
        .mockResolvedValueOnce(makeLLMResponse('stop', { content: 'done' }));

      deps.pipelineProcessMock.mockResolvedValue(makePipelineResult());

      const agent = buildAgent(deps);
      const result = await agent.handle({ source: 'trigger', prompt: 'move' });

      expect(result.finalResponse).toBe('done');
      // rounds=1：第 1 轮 tool_calls（rounds=0 进循环）后 rounds++→1，
      // 第 2 轮 stop（rounds=1 进循环）break，rounds 保持 1
      expect(result.rounds).toBe(1);
      expect(deps.providerChatMock).toHaveBeenCalledTimes(2);
      expect(deps.pipelineProcessMock).toHaveBeenCalledTimes(1);

      // history.append 应被调 3 次：1 assistant(tool_calls) + 1 tool_result + 1 assistant(stop)
      expect(deps.historyAppendMock).toHaveBeenCalledTimes(3);
      const roles = deps.historyAppendMock.mock.calls.map(c => c[0].role);
      expect(roles).toEqual(['assistant', 'tool', 'assistant']);
    });
  });

  // ───────────────────────────────────────────────────────
  // 3. maxRounds 截断
  // ───────────────────────────────────────────────────────
  describe('maxRounds 截断', () => {
    it('连续 tool_calls 达 maxRounds 后返回 truncated+MAX_ROUNDS_EXCEEDED', async () => {
      // 每轮都返回 tool_calls，永不 stop
      deps.providerChatMock.mockResolvedValue(makeLLMResponse('tool_calls', {
        toolCalls: [{ toolCallId: 'c1', toolName: 'noop', arguments: {} }],
      }));
      deps.pipelineProcessMock.mockResolvedValue(makePipelineResult());

      const agent = buildAgent(deps, { maxRounds: 3 });
      const result = await agent.handle({ source: 'trigger', prompt: 'loop' });

      expect(result.rounds).toBe(3);
      expect(result.truncated).toBe(true);
      expect(result.error).toBe('MAX_ROUNDS_EXCEEDED');
      expect(deps.providerChatMock).toHaveBeenCalledTimes(3);
    });
  });

  // ───────────────────────────────────────────────────────
  // 4. abort 透传
  // ───────────────────────────────────────────────────────
  describe('abort 透传', () => {
    it('外部 abortSignal 已 aborted 时立即返回 ABORTED', async () => {
      const ac = new AbortController();
      ac.abort();

      const agent = buildAgent(deps, { abortSignal: ac.signal });
      const result = await agent.handle({ source: 'trigger', prompt: 'x' });

      expect(result.error).toBe('ABORTED');
      expect(deps.providerChatMock).not.toHaveBeenCalled();
    });

    it('循环中触发 abort 返回 ABORTED', async () => {
      const ac = new AbortController();

      // 第一轮 tool_calls 后，在 pipeline 过程中 abort
      deps.providerChatMock.mockResolvedValueOnce(makeLLMResponse('tool_calls', {
        toolCalls: [{ toolCallId: 'c1', toolName: 'noop', arguments: {} }],
      }));
      // 让 pipeline.process 抛 AbortError
      deps.pipelineProcessMock.mockImplementation(async () => {
        ac.abort();
        throw new AbortError('aborted in pipeline');
      });

      const agent = buildAgent(deps, { abortSignal: ac.signal });
      const result = await agent.handle({ source: 'trigger', prompt: 'x' });

      expect(result.error).toBe('ABORTED');
    });
  });

  // ───────────────────────────────────────────────────────
  // 5. Provider 未注册
  // ───────────────────────────────────────────────────────
  describe('Provider 未注册', () => {
    it('providerRegistry.get 返回 undefined 时返回 PROVIDER_NOT_FOUND', async () => {
      (deps.providerRegistry.get as ReturnType<typeof vi.fn>).mockReturnValue(undefined);

      const agent = buildAgent(deps);
      const result = await agent.handle({ source: 'trigger', prompt: 'x' });

      expect(result.error).toMatch(/PROVIDER_NOT_FOUND/);
      expect(deps.providerChatMock).not.toHaveBeenCalled();
    });
  });

  // ───────────────────────────────────────────────────────
  // 6. World 离线
  // ───────────────────────────────────────────────────────
  describe('World 离线', () => {
    it('pipeline 抛 NotConnectedError 时返回 WORLD_OFFLINE', async () => {
      deps.providerChatMock.mockResolvedValueOnce(makeLLMResponse('tool_calls', {
        toolCalls: [{ toolCallId: 'c1', toolName: 'move_to', arguments: {} }],
      }));
      deps.pipelineProcessMock.mockRejectedValue(new NotConnectedError('ws-001'));

      const agent = buildAgent(deps);
      const result = await agent.handle({ source: 'trigger', prompt: 'x' });

      expect(result.error).toBe('WORLD_OFFLINE');
    });
  });

  // ───────────────────────────────────────────────────────
  // 7. abort() 方法
  // ───────────────────────────────────────────────────────
  describe('abort() 方法', () => {
    it('调用 abort() 后 handle 应返回 ABORTED', async () => {
      // 让 provider.chat 在被调用时 abort
      deps.providerChatMock.mockImplementation(async () => {
        agent.abort();
        // 仍然返回一个 response，但下一轮检查 signal.aborted 会 break
        return makeLLMResponse('tool_calls', {
          toolCalls: [{ toolCallId: 'c1', toolName: 'noop', arguments: {} }],
        });
      });
      deps.pipelineProcessMock.mockResolvedValue(makePipelineResult());

      const agent = buildAgent(deps);
      const result = await agent.handle({ source: 'trigger', prompt: 'x' });

      // 下一轮 signal.aborted → 返回 ABORTED
      expect(result.error).toBe('ABORTED');
    });
  });

  // ───────────────────────────────────────────────────────
  // 8. stream() 入口
  // ───────────────────────────────────────────────────────
  describe('stream() 入口', () => {
    it('应 yield text chunk + done', async () => {
      deps.providerChatMock.mockResolvedValue(makeLLMResponse('stop', { content: 'hello' }));

      const agent = buildAgent(deps);
      const chunks: Array<{ type: string; content?: string }> = [];
      for await (const c of agent.stream({ source: 'trigger', prompt: 'x' })) {
        chunks.push(c);
      }

      expect(chunks).toEqual([
        { type: 'text', content: 'hello' },
        { type: 'done' },
      ]);
    });
  });
});
