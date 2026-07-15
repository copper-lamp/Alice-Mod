/**
 * V20 §4.9 MainAgentRegistry 单元测试
 *
 * 验收覆盖（执行文档 §3.3）：
 * - 缓存命中：第二次 get 直接返回缓存
 * - getSync：仅查缓存，未命中返回 undefined
 * - 未命中 + AgentConfig 不存在 → 返回 undefined
 * - 未命中 + 缺 llmConfig.mainModel.providerId → 返回 undefined
 * - refresh(agentId) 失效缓存
 * - invalidate(workspaceId, agentId) 精确失效
 * - list() 列出当前缓存
 * - 并发同 key get 复用 in-flight Promise
 * - clear() 清空所有
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AgentConfig } from '../../src/renderer/src/lib/types';
import type { AgentConfigManager } from '../../src/main/agent/agent-config-manager';
import type { ToolRegistry } from '../../src/main/workspace/tool-registry';
import type { PromptBuilder } from '../../src/main/prompt/builder/prompt-builder';
import type {
  IModelRouter,
  IProviderRegistry,
  ILLMObserver,
} from '../../src/main/llm/types';
import type { FunctionCallingPipeline } from '../../src/main/pipeline/pipeline';
import type { ConnectionResolver } from '../../src/main/agent/connection-resolver';
import type { ChatHistoryStore } from '../../src/main/chat-history/chat-history-store';
import type { LlmRequestScheduler } from '../../src/main/llm/scheduler/types';
import { MainAgentRegistry } from '../../src/main/agent/main-agent-registry';
import type { MainAgent } from '../../src/main/agent/main-agent';

// ═══════════════════════════════════════════════════════════
// Mock 工厂
// ═══════════════════════════════════════════════════════════

function makeAgentConfig(id: string, opts: { withLlm?: boolean; workspaceId?: string } = {}): AgentConfig {
  const withLlm = opts.withLlm ?? true;
  return {
    id,
    name: `Agent-${id}`,
    persona: {
      identity: 'test',
      expertise: [],
      personality: ['冷静'],
      workflowId: 'explore_gather',
    },
    tools: { enabledTools: {} },
    qqBinding: { enabled: false },
    llmConfig: withLlm
      ? {
          mainModel: { providerId: 'openai', modelId: 'gpt-4o', modelName: 'gpt-4o' },
          qqBotModel: { providerId: 'openai', modelId: 'gpt-4o', modelName: 'gpt-4o' },
          compressionModel: { providerId: 'openai', modelId: 'gpt-4o', modelName: 'gpt-4o' },
        }
      : { mainModel: { providerId: '', modelId: '', modelName: '' }, qqBotModel: { providerId: '', modelId: '', modelName: '' }, compressionModel: { providerId: '', modelId: '', modelName: '' } },
    isMain: true,
    workspaceId: opts.workspaceId ?? 'ws-001',
  };
}

function buildRegistryDeps(opts: {
  agentConfigManagerGetMock: ReturnType<typeof vi.fn>;
}) {
  return {
    agentConfigManager: {
      get: opts.agentConfigManagerGetMock,
      list: vi.fn().mockResolvedValue([]),
      listByWorkspace: vi.fn().mockResolvedValue([]),
      getMainAgent: vi.fn(),
      markMain: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    } as unknown as AgentConfigManager,
    toolRegistry: { getTools: () => [] } as unknown as ToolRegistry,
    modelRouter: {} as IModelRouter,
    providerRegistry: {} as IProviderRegistry,
    connectionResolver: {} as ConnectionResolver,
    historyStore: {} as ChatHistoryStore,
    scheduler: {} as LlmRequestScheduler,
    observer: {} as ILLMObserver,
    // 工厂 mock：返回带 setDispatcher/setCollector 方法的对象
    pipelineFactory: vi.fn().mockReturnValue({
      setDispatcher: vi.fn(),
      setCollector: vi.fn(),
    }),
    promptBuilderFactory: vi.fn().mockReturnValue({}),
    maxRounds: 5,
  };
}

// ═══════════════════════════════════════════════════════════
// 测试用例
// ═══════════════════════════════════════════════════════════

describe('MainAgentRegistry', () => {
  let registry: MainAgentRegistry;
  let agentConfigManagerGetMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    agentConfigManagerGetMock = vi.fn();
    const deps = buildRegistryDeps({ agentConfigManagerGetMock });
    registry = new MainAgentRegistry(deps);
  });

  // ───────────────────────────────────────────────────────
  // 1. 缓存命中
  // ───────────────────────────────────────────────────────
  describe('缓存命中', () => {
    it('首次 get 应构造并缓存；第二次 get 直接返回缓存（不重复调 agentConfigManager.get）', async () => {
      agentConfigManagerGetMock.mockResolvedValue(makeAgentConfig('agent-01'));

      const a1 = await registry.get('ws-001', 'agent-01');
      expect(a1).toBeInstanceOf(Object);
      expect(agentConfigManagerGetMock).toHaveBeenCalledTimes(1);

      const a2 = await registry.get('ws-001', 'agent-01');
      expect(a2).toBe(a1); // 同一实例
      expect(agentConfigManagerGetMock).toHaveBeenCalledTimes(1); // 未再次读 config
    });

    it('getSync 未构造时返回 undefined；构造后返回缓存实例', async () => {
      agentConfigManagerGetMock.mockResolvedValue(makeAgentConfig('agent-02'));

      expect(registry.getSync('ws-001', 'agent-02')).toBeUndefined();

      const a = await registry.get('ws-001', 'agent-02');
      expect(registry.getSync('ws-001', 'agent-02')).toBe(a);
    });
  });

  // ───────────────────────────────────────────────────────
  // 2. 未命中返回 undefined
  // ───────────────────────────────────────────────────────
  describe('未命中返回 undefined', () => {
    it('AgentConfig 不存在时返回 undefined', async () => {
      agentConfigManagerGetMock.mockResolvedValue(undefined);

      const a = await registry.get('ws-001', 'agent-missing');
      expect(a).toBeUndefined();
      expect(registry.getSync('ws-001', 'agent-missing')).toBeUndefined();
    });

    it('AgentConfig 缺 llmConfig.mainModel.providerId 时返回 undefined', async () => {
      agentConfigManagerGetMock.mockResolvedValue(makeAgentConfig('agent-bad', { withLlm: false }));

      const a = await registry.get('ws-001', 'agent-bad');
      expect(a).toBeUndefined();
    });
  });

  // ───────────────────────────────────────────────────────
  // 3. refresh / invalidate
  // ───────────────────────────────────────────────────────
  describe('refresh / invalidate', () => {
    it('refresh(agentId) 失效后再次 get 会重新构造', async () => {
      agentConfigManagerGetMock.mockResolvedValue(makeAgentConfig('agent-r'));

      const a1 = await registry.get('ws-001', 'agent-r');
      expect(a1).toBeDefined();

      registry.refresh('agent-r');
      expect(registry.getSync('ws-001', 'agent-r')).toBeUndefined();

      // 重新构造
      const a2 = await registry.get('ws-001', 'agent-r');
      expect(a2).toBeDefined();
      expect(a2).not.toBe(a1); // 新实例
      expect(agentConfigManagerGetMock).toHaveBeenCalledTimes(2);
    });

    it('invalidate(workspaceId, agentId) 精确失效', async () => {
      agentConfigManagerGetMock.mockResolvedValue(makeAgentConfig('agent-i'));

      await registry.get('ws-001', 'agent-i');
      expect(registry.list()).toHaveLength(1);

      registry.invalidate('ws-001', 'agent-i');
      expect(registry.list()).toHaveLength(0);
      expect(registry.getSync('ws-001', 'agent-i')).toBeUndefined();
    });

    it('refresh 未缓存的 agentId 是 no-op', () => {
      expect(() => registry.refresh('agent-not-exist')).not.toThrow();
    });
  });

  // ───────────────────────────────────────────────────────
  // 4. list / clear
  // ───────────────────────────────────────────────────────
  describe('list / clear', () => {
    it('list 列出当前缓存的所有 (workspaceId, agentId)', async () => {
      agentConfigManagerGetMock
        .mockResolvedValueOnce(makeAgentConfig('a1', { workspaceId: 'ws-1' }))
        .mockResolvedValueOnce(makeAgentConfig('a2', { workspaceId: 'ws-2' }));

      await registry.get('ws-1', 'a1');
      await registry.get('ws-2', 'a2');

      const list = registry.list();
      expect(list).toHaveLength(2);
      expect(list).toContainEqual({ workspaceId: 'ws-1', agentId: 'a1' });
      expect(list).toContainEqual({ workspaceId: 'ws-2', agentId: 'a2' });
    });

    it('clear 清空所有缓存', async () => {
      agentConfigManagerGetMock.mockResolvedValue(makeAgentConfig('a1'));

      await registry.get('ws-1', 'a1');
      expect(registry.list()).toHaveLength(1);

      registry.clear();
      expect(registry.list()).toHaveLength(0);
      expect(registry.getSync('ws-1', 'a1')).toBeUndefined();
    });
  });

  // ───────────────────────────────────────────────────────
  // 5. 并发同 key 复用 in-flight Promise
  // ───────────────────────────────────────────────────────
  describe('并发安全', () => {
    it('同 key 并发 get 只触发一次 agentConfigManager.get', async () => {
      let resolveGet!: (v: AgentConfig) => void;
      agentConfigManagerGetMock.mockReturnValue(
        new Promise<AgentConfig>((r) => { resolveGet = r; }),
      );

      // 同时发起 3 个 get
      const p1 = registry.get('ws-001', 'agent-concurrent');
      const p2 = registry.get('ws-001', 'agent-concurrent');
      const p3 = registry.get('ws-001', 'agent-concurrent');

      // 还未 resolve
      expect(agentConfigManagerGetMock).toHaveBeenCalledTimes(1);

      resolveGet(makeAgentConfig('agent-concurrent'));
      const [a1, a2, a3] = await Promise.all([p1, p2, p3]);

      expect(a1).toBe(a2);
      expect(a2).toBe(a3);
      expect(agentConfigManagerGetMock).toHaveBeenCalledTimes(1);
    });

    it('不同 key 并发 get 各自独立构造', async () => {
      agentConfigManagerGetMock
        .mockResolvedValueOnce(makeAgentConfig('a-x'))
        .mockResolvedValueOnce(makeAgentConfig('a-y'));

      const [ax, ay] = await Promise.all([
        registry.get('ws-001', 'a-x'),
        registry.get('ws-001', 'a-y'),
      ]);

      expect(ax).not.toBe(ay);
      expect(registry.list()).toHaveLength(2);
    });
  });
});
