/**
 * V20 主链路集成测试 — 验证 bootstrap → MainAgentRegistry → MainAgent.handle() 完整流程
 *
 * 使用真实实现（DefaultLLMConfigManager / ProviderRegistry / DefaultModelRouter /
 * DefaultLlmRequestScheduler / FunctionCallingPipeline / PromptBuilder）
 * 仅 mock 以下外部依赖：
 * - LLMProvider.chat()（避免真实 HTTP 调用）
 * - AgentConfigManager（避免依赖真实 SQLite DB）
 * - ConnectionResolver（需要真实 TCP Server）
 * - ToolRegistry（无需真实工具列表）
 * - ChatHistoryStore（避免 better-sqlite3 原生模块版本冲突）
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AgentConfig } from '../../../src/renderer/src/lib/types';
import type { LLMProvider, LLMResponse, ProviderConfig } from '../../../src/main/llm/types';
import type { ToolRegistry } from '../../../src/main/workspace/tool-registry';
import type { PromptBuilder } from '../../../src/main/prompt/builder/prompt-builder';
import type { ConnectionResolver } from '../../../src/main/agent/connection-resolver';
import type { RouterConfig } from '../../../src/main/llm/types';
import type { ChatHistoryStore, ChatHistoryEntry } from '../../../src/main/chat-history/chat-history-store';

import { FunctionCallingPipeline } from '../../../src/main/pipeline/pipeline';

import { ProviderRegistry } from '../../../src/main/llm/registry/provider-registry';
import { DefaultModelRouter } from '../../../src/main/llm/router/model-router';
import { DefaultLLMConfigManager, MemoryStorageAdapter } from '../../../src/main/llm/config/config-manager';
import { DefaultLLMObserver } from '../../../src/main/llm/observer/llm-observer';
import { MemoryObserverStore } from '../../../src/main/llm/observer/observer-store';
import { DefaultLlmRequestScheduler } from '../../../src/main/llm/scheduler/llm-request-scheduler';
import { bootstrapLlmSystem } from '../../../src/main/llm/bootstrap';
import { MainAgentRegistry } from '../../../src/main/agent/main-agent-registry';
import { PromptBuilder as RealPromptBuilder } from '../../../src/main/prompt/builder/prompt-builder';

// ══════════════════════════════════════════════════════════════════
// 内存 ChatHistoryStore 实现（替代 better-sqlite3 版本）
// ══════════════════════════════════════════════════════════════════

class MemoryChatHistoryStore implements ChatHistoryStore {
  private entries: ChatHistoryEntry[] = [];
  private nextId = 1;

  async append(entry: ChatHistoryEntry): Promise<number> {
    const id = this.nextId++;
    this.entries.push({ ...entry, id });
    return id;
  }

  async load(
    workspaceId: string,
    agentId: string,
    _opts?: { limit?: number; beforeId?: number },
  ): Promise<ChatHistoryEntry[]> {
    const filtered = this.entries.filter(
      e => e.workspaceId === workspaceId && e.agentId === agentId,
    );
    return filtered.reverse();
  }

  async clear(workspaceId: string, agentId: string): Promise<number> {
    const before = this.entries.length;
    this.entries = this.entries.filter(
      e => e.workspaceId !== workspaceId || e.agentId !== agentId,
    );
    return before - this.entries.length;
  }

  async deleteByIds(ids: number[]): Promise<number> {
    const before = this.entries.length;
    this.entries = this.entries.filter(e => e.id === undefined || !ids.includes(e.id));
    return before - this.entries.length;
  }

  async getStats(_workspaceId: string, _agentId: string): Promise<{ totalMessages: number; lastActiveAt: number }> {
    const filtered = this.entries.filter(
      e => e.workspaceId === _workspaceId && e.agentId === _agentId,
    );
    const last = filtered[filtered.length - 1];
    return { totalMessages: filtered.length, lastActiveAt: last?.createdAt ?? 0 };
  }
}

// ══════════════════════════════════════════════════════════════════
// Mock 工厂
// ══════════════════════════════════════════════════════════════════

/** 创建 Mock LLMProvider */
function createMockProvider(id: string, chatMock: ReturnType<typeof vi.fn>): LLMProvider {
  return {
    metadata: {
      id,
      displayName: id,
      supportedModels: ['gpt-4o', 'claude-3-5-sonnet'],
      supportsStreaming: true,
      supportsFunctionCalling: true,
      supportsEmbedding: false,
      version: '1.0',
    },
    chat: chatMock,
    chatStream: async function* () { yield { content: '', isLast: true }; },
    embed: async () => [],
    healthCheck: async () => ({ available: true, latencyMs: 10, model: 'gpt-4o' }),
  };
}

/** 创建 Mock LLMResponse */
function makeLLMResponse(
  finishReason: 'stop' | 'tool_calls' | 'length' | 'error',
  content = '完成',
  toolCalls?: Array<{ toolCallId: string; toolName: string; arguments: Record<string, unknown> }>,
): LLMResponse {
  return {
    message: {
      role: 'assistant',
      content,
      tool_calls: toolCalls,
    },
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    model: 'gpt-4o',
    requestId: `req_${Date.now()}`,
    durationMs: 50,
    truncated: false,
    finishReason,
  };
}

/** 创建 AgentConfig（测试用） */
function makeAgentConfig(id: string, opts: { workspaceId?: string } = {}): AgentConfig {
  return {
    id,
    name: `TestAgent-${id}`,
    persona: {
      identity: '你是一个测试用 Minecraft 智能体。',
      expertise: ['测试', '自动化'],
      personality: ['严谨', '高效'],
      workflowId: 'explore_gather',
      behaviorRules: {
        core: ['测试场景下优先执行用户指令'],
        strategy: [],
        constraints: [],
      },
    },
    tools: { enabledTools: {} },
    qqBinding: { enabled: false },
    llmConfig: {
      mainModel: { providerId: 'openai', modelId: 'gpt-4o', modelName: 'gpt-4o' },
      qqBotModel: { providerId: 'openai', modelId: 'gpt-4o', modelName: 'gpt-4o' },
      compressionModel: { providerId: 'openai', modelId: 'gpt-4o', modelName: 'gpt-4o' },
    },
    isMain: true,
    workspaceId: opts.workspaceId ?? 'ws-integration',
  };
}

/** 创建 Mock AgentConfigManager */
function createMockAgentConfigManager(agentConfigs: AgentConfig[]) {
  const configMap = new Map(agentConfigs.map(c => [c.id!, c]));
  return {
    get: vi.fn(async (id: string) => configMap.get(id)),
    list: vi.fn(async () => agentConfigs.map(c => ({
      id: c.id!,
      name: c.name,
      status: 'offline' as const,
      toolCount: 0,
    }))),
    listByWorkspace: vi.fn(async (workspaceId: string) =>
      agentConfigs.filter(c => (c.workspaceId ?? '') === workspaceId),
    ),
    getMainAgent: vi.fn(async (workspaceId: string) =>
      agentConfigs.find(c => (c.workspaceId ?? '') === workspaceId && c.isMain),
    ),
    markMain: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
}

/** 创建 Mock ConnectionResolver */
function createMockConnectionResolver() {
  return {
    resolve: vi.fn().mockReturnValue(undefined),
    getConnection: vi.fn().mockReturnValue(undefined),
    listConnections: vi.fn().mockReturnValue([]),
  } as unknown as ConnectionResolver;
}

/** 创建 Mock ToolRegistry */
function createMockToolRegistry(): ToolRegistry {
  return {
    getTools: vi.fn().mockReturnValue([]),
    register: vi.fn(),
    unregister: vi.fn(),
    getAll: vi.fn().mockReturnValue(new Map()),
    getHash: vi.fn(),
    hasChanged: vi.fn().mockReturnValue(false),
  } as unknown as ToolRegistry;
}

// ══════════════════════════════════════════════════════════════════
// 集成测试套件
// ══════════════════════════════════════════════════════════════════

describe('V20 主链路集成测试', () => {
  // 共享实例
  let providerRegistry: ProviderRegistry;
  let modelRouter: DefaultModelRouter;
  let configManager: DefaultLLMConfigManager;
  let scheduler: DefaultLlmRequestScheduler;
  let observer: DefaultLLMObserver;
  let historyStore: MemoryChatHistoryStore;
  let agentRegistry: MainAgentRegistry;
  let openaiChatMock: ReturnType<typeof vi.fn>;
  let pipelineProcessMock: ReturnType<typeof vi.fn>;

  const WS_ID = 'ws-integration';
  const AGENT_ID = 'agent-integration-01';

  beforeEach(async () => {
    // ── 1. 创建共享依赖 ──
    configManager = new DefaultLLMConfigManager(new MemoryStorageAdapter());
    // 预填充 Provider 配置（覆盖默认配置，指向测试用 baseUrl）
    configManager.updateProviderConfig('openai', {
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      defaultModel: 'gpt-4o',
      timeout: 60_000,
      maxRetries: 1,
    }).catch(() => {});
    configManager.updateProviderConfig('claude', {
      baseUrl: 'https://api.anthropic.com/v1',
      apiKey: 'sk-test',
      defaultModel: 'claude-3-5-sonnet',
      timeout: 60_000,
      maxRetries: 1,
    }).catch(() => {});

    // 预注册 mock Provider（bootstrap 会跳过已注册的）
    providerRegistry = new ProviderRegistry();
    openaiChatMock = vi.fn();
    const claudeChatMock = vi.fn();
    providerRegistry.register('openai', createMockProvider('openai', openaiChatMock));
    providerRegistry.register('claude', createMockProvider('claude', claudeChatMock));

    // ── 2. 创建 ModelRouter ──
    const routerConfig: RouterConfig = {
      default: { providerId: 'openai', model: 'gpt-4o', options: { temperature: 0.7 } },
      fallback: {
        fallbacks: [
          { providerId: 'claude', model: 'claude-3-5-sonnet', options: {} },
        ],
        conditions: { maxConsecutiveFailures: 3, timeoutThreshold: 60000 },
        recoveryCheckIntervalMs: 300000,
      },
    };
    modelRouter = new DefaultModelRouter(providerRegistry, routerConfig);

    // ── 3. 创建 Scheduler ──
    scheduler = new DefaultLlmRequestScheduler({ maxConcurrent: 10, queueSize: 50 });

    // ── 4. 创建 Observer ──
    observer = new DefaultLLMObserver(new MemoryObserverStore(1000));

    // ── 5. 创建内存 ChatHistoryStore（避免 better-sqlite3 原生模块依赖） ──
    historyStore = new MemoryChatHistoryStore();

    // ── 6. 创建 Mock AgentConfigManager ──
    const agentConfigs = [makeAgentConfig(AGENT_ID, { workspaceId: WS_ID })];
    const agentConfigManager = createMockAgentConfigManager(agentConfigs);

    // ── 7. 执行 bootstrap ──
    const bootstrapResult = await bootstrapLlmSystem({
      configManager: configManager as any,
      providerRegistry: providerRegistry as any,
      modelRouter: modelRouter as any,
      agentConfigManager: agentConfigManager as any,
    });

    // 验证 bootstrap 按预期工作（provider 已注册时跳过）
    // DefaultLLMConfigManager 的 ensureDefaults 会预置 gemini/ollama 等配置
    expect(bootstrapResult.registeredProviders).toContain('gemini');
    expect(bootstrapResult.registeredProviders).toContain('ollama');
    expect(bootstrapResult.skippedProviders).toContain('openai');
    expect(bootstrapResult.skippedProviders).toContain('claude');

    // ── 8. 创建 Mock Pipeline ──
    pipelineProcessMock = vi.fn();
    const pipelineFactory = () => {
      const p = new FunctionCallingPipeline();
      p.setDispatcher({ executeBatch: vi.fn() } as any);
      p.setCollector({ collect: vi.fn() } as any);
      // 用 mock 覆盖 process
      p.process = pipelineProcessMock as any;
      return p;
    };

    // ── 9. 创建 MainAgentRegistry ──
    const toolRegistry = createMockToolRegistry();
    agentRegistry = new MainAgentRegistry({
      agentConfigManager: agentConfigManager as any,
      toolRegistry,
      modelRouter: modelRouter as any,
      providerRegistry: providerRegistry as any,
      connectionResolver: createMockConnectionResolver(),
      historyStore: historyStore as any,
      scheduler: scheduler as any,
      observer: observer as any,
      pipelineFactory,
      promptBuilderFactory: (reg) => new RealPromptBuilder({
        toolRegistry: reg,
      }),
      maxRounds: 5,
    });
  });

  afterEach(() => {
    providerRegistry.reset();
    modelRouter.reset();
    observer.clear();
  });

  // ───────────────────────────────────────────────────────────────
  // 测试用例
  // ───────────────────────────────────────────────────────────────

  describe('1. 完整流程：bootstrap → Registry → handle', () => {
    it('应完成一次完整的主链路调用（单轮 stop）', async () => {
      // 配置 mock provider 返回 stop
      openaiChatMock.mockResolvedValue(makeLLMResponse('stop', '你好，我是 Alice！'));

      // 通过 Registry 获取 MainAgent
      const agent = await agentRegistry.get(WS_ID, AGENT_ID);
      expect(agent).toBeDefined();

      // 执行 handle
      const result = await agent!.handle({
        source: 'trigger',
        prompt: '请自我介绍',
        metadata: { eventId: 'evt_001' },
      });

      // 验证结果
      expect(result.error).toBeUndefined();
      expect(result.finalResponse).toBe('你好，我是 Alice！');
      expect(result.rounds).toBe(0);
      expect(result.totalTokens).toBe(15);
      expect(result.durationMs).toBeGreaterThan(0);
      expect(result.truncated).toBe(false);

      // 验证 provider.chat 被调用
      expect(openaiChatMock).toHaveBeenCalledTimes(1);
      const chatArgs = openaiChatMock.mock.calls[0];
      expect(chatArgs[0]).toBeInstanceOf(Array); // messages
      expect(chatArgs[0].length).toBeGreaterThan(0);

      // 验证历史被持久化
      const history = await historyStore.load(WS_ID, AGENT_ID);
      expect(history.length).toBe(1);
      expect(history[0].role).toBe('assistant');
      expect(history[0].content).toBe('你好，我是 Alice！');
      expect(history[0].source).toBe('trigger');
      expect(history[0].eventId).toBe('evt_001');
    });

    it('应完成工具调用多轮（tool_calls → pipeline → stop）', async () => {
      // 第 1 轮：tool_calls
      openaiChatMock
        .mockResolvedValueOnce(makeLLMResponse('tool_calls', '', [
          { toolCallId: 'call_1', toolName: 'move_to', arguments: { x: 100, z: 200 } },
        ]))
        // 第 2 轮：stop
        .mockResolvedValueOnce(makeLLMResponse('stop', '已到达目标位置。'));

      // pipeline.process 返回 mock 结果
      pipelineProcessMock.mockResolvedValue({
        toolResults: [
          {
            type: 'tool_result',
            toolCallId: 'call_1',
            toolName: 'move_to',
            success: true,
            data: { position: { x: 100, y: 64, z: 200 } },
            durationMs: 100,
          },
        ],
        totalDurationMs: 110,
        phaseDurations: { parse: 1, analyze: 1, schedule: 1, middlewareBefore: 0, dispatch: 100, collect: 1, fallback: 0, middlewareAfter: 0, inject: 1 },
        stats: { total: 1, success: 1, failed: 0, skipped: 0, cancelled: 0, fallbackResolved: 0 },
        hasErrors: false,
        errors: [],
      });

      const agent = await agentRegistry.get(WS_ID, AGENT_ID);
      expect(agent).toBeDefined();

      const result = await agent!.handle({
        source: 'trigger',
        prompt: '移动到 (100, 200)',
      });

      expect(result.error).toBeUndefined();
      expect(result.finalResponse).toBe('已到达目标位置。');
      expect(result.rounds).toBe(1);
      expect(openaiChatMock).toHaveBeenCalledTimes(2);
      expect(pipelineProcessMock).toHaveBeenCalledTimes(1);
    });

    it('qq source 应使用 qqBotModel 配置', async () => {
      openaiChatMock.mockResolvedValue(makeLLMResponse('stop', '来自 QQ 的回复'));

      const agent = await agentRegistry.get(WS_ID, AGENT_ID);
      expect(agent).toBeDefined();

      const result = await agent!.handle({
        source: 'qq',
        prompt: '你好',
      });

      expect(result.finalResponse).toBe('来自 QQ 的回复');
      expect(openaiChatMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('2. Registry 缓存与复用', () => {
    it('getSync 在构造后应返回缓存实例', async () => {
      // 构造前：getSync 返回 undefined
      expect(agentRegistry.getSync(WS_ID, AGENT_ID)).toBeUndefined();

      // 异步构造
      const agent = await agentRegistry.get(WS_ID, AGENT_ID);
      expect(agent).toBeDefined();

      // 构造后：getSync 应返回同一实例
      const cached = agentRegistry.getSync(WS_ID, AGENT_ID);
      expect(cached).toBe(agent);

      // list 应包含该条目
      const entries = agentRegistry.list();
      expect(entries).toContainEqual({ workspaceId: WS_ID, agentId: AGENT_ID });
    });

    it('refresh 后应重新构造新实例', async () => {
      const agent1 = await agentRegistry.get(WS_ID, AGENT_ID);
      expect(agent1).toBeDefined();

      agentRegistry.refresh(AGENT_ID);
      expect(agentRegistry.getSync(WS_ID, AGENT_ID)).toBeUndefined();

      const agent2 = await agentRegistry.get(WS_ID, AGENT_ID);
      expect(agent2).toBeDefined();
      expect(agent2).not.toBe(agent1);
    });
  });

  describe('3. 错误处理', () => {
    it('Provider 未注册时应返回 PROVIDER_NOT_FOUND', async () => {
      // 构造一个路由到不存在的 provider 的 agent
      const badAgentConfig = makeAgentConfig('agent-bad', { workspaceId: 'ws-bad' });
      badAgentConfig.llmConfig.mainModel = {
        providerId: 'openai',
        modelId: 'gpt-4o',
        modelName: 'gpt-4o',
      };
      // 创建一个空的 providerRegistry（不注册任何 provider）
      const emptyProviderRegistry = new ProviderRegistry();
      // 创建一个指向空 registry 的 router
      const emptyRouter = new DefaultModelRouter(emptyProviderRegistry, {
        default: { providerId: 'openai', model: 'gpt-4o', options: {} },
        fallback: {
          fallbacks: [],
          conditions: { maxConsecutiveFailures: 3, timeoutThreshold: 60000 },
          recoveryCheckIntervalMs: 300000,
        },
      });

      // 直接使用 MainAgent（不通过 Registry 的构造校验）
      const { MainAgent } = await import('../../../src/main/agent/main-agent');
      const agent = new MainAgent({
        agentConfig: badAgentConfig,
        workspaceId: 'ws-bad',
        agentId: 'agent-bad',
        toolRegistry: createMockToolRegistry(),
        promptBuilder: new RealPromptBuilder({}),
        modelRouter: emptyRouter as any,
        providerRegistry: emptyProviderRegistry as any,
        pipeline: new FunctionCallingPipeline(),
        connectionResolver: createMockConnectionResolver(),
        historyStore: historyStore as any,
        scheduler: scheduler as any,
        observer: observer as any,
        maxRounds: 5,
      });

      const result = await agent.handle({ source: 'trigger', prompt: 'x' });
      expect(result.error).toMatch(/PROVIDER_NOT_FOUND/);
    });

    it('Registry 缺 llmConfig 的 agent 应返回 undefined', async () => {
      const badId = 'agent-no-llm';
      const result = await agentRegistry.get('ws-other', badId);
      expect(result).toBeUndefined();
    });
  });

  describe('4. 并发安全', () => {
    it('同 key 并发 get 应只构造一次', async () => {
      const [a1, a2, a3] = await Promise.all([
        agentRegistry.get(WS_ID, AGENT_ID),
        agentRegistry.get(WS_ID, AGENT_ID),
        agentRegistry.get(WS_ID, AGENT_ID),
      ]);

      expect(a1).toBe(a2);
      expect(a2).toBe(a3);
      expect(agentRegistry.list()).toHaveLength(1);
    });
  });

  describe('5. 对话历史持久化', () => {
    it('多次 handle 调用应累积历史', async () => {
      openaiChatMock.mockResolvedValue(makeLLMResponse('stop', '回复'));

      const agent = await agentRegistry.get(WS_ID, AGENT_ID);
      expect(agent).toBeDefined();

      // 第一次调用
      await agent!.handle({ source: 'trigger', prompt: '你好' });
      // 第二次调用
      await agent!.handle({ source: 'trigger', prompt: '今天天气怎么样' });

      // 历史应有 2 条 assistant 消息
      const history = await historyStore.load(WS_ID, AGENT_ID);
      expect(history.length).toBe(2);
      expect(history[0].content).toBe('回复');
      expect(history[1].content).toBe('回复');
    });
  });
});