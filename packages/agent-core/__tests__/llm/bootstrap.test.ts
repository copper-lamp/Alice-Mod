/**
 * V20 §4.5 bootstrapLlmSystem 单元测试
 *
 * 验收覆盖（执行文档 §3.3）：
 * - Provider 注册：getProviderConfigs → 逐个 register 到 providerRegistry
 * - 幂等：第二次调用跳过已注册的 Provider
 * - workspace 路由配置：agentConfig.mainModel → modelRouter.updateConfig 的 workspaces
 * - 跳过缺 mainModel.providerId / modelName 的 agent
 * - resolveProviderClass 4 分支推断（anthropic / googleapis / ollama / 默认 OpenAI）
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ProviderConfig, RouterConfig } from '../../src/main/llm/types';
import type { AgentConfig } from '../../src/renderer/src/lib/types';
import {
  bootstrapLlmSystem,
  resolveProviderClass,
} from '../../src/main/llm/bootstrap';
import { OpenAIProvider } from '../../src/main/llm/providers/openai';
import { ClaudeProvider } from '../../src/main/llm/providers/claude';
import { GeminiProvider } from '../../src/main/llm/providers/gemini';
import { OllamaProvider } from '../../src/main/llm/providers/ollama';

// ═══════════════════════════════════════════════════════════
// Mock 工厂
// ═══════════════════════════════════════════════════════════

function makeProviderConfig(baseUrl: string, defaultModel = 'test-model'): ProviderConfig {
  return {
    baseUrl,
    apiKey: 'sk-test',
    defaultModel,
    timeout: 60_000,
    maxRetries: 3,
  };
}

function makeAgentConfig(
  id: string,
  opts: { providerId?: string; modelName?: string; workspaceId?: string } = {},
): AgentConfig {
  const providerId = opts.providerId ?? 'openai';
  const modelName = opts.modelName ?? 'gpt-4o';
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
    llmConfig: {
      mainModel: { providerId, modelId: modelName, modelName },
      qqBotModel: { providerId, modelId: modelName, modelName },
      compressionModel: { providerId, modelId: modelName, modelName },
    },
    isMain: true,
    workspaceId: opts.workspaceId ?? 'ws-001',
  };
}

function buildMocks(opts: {
  providerConfigs?: Record<string, ProviderConfig>;
  agentConfigs?: AgentConfig[];
  registeredProviderIds?: string[];
} = {}) {
  const providerConfigs = opts.providerConfigs ?? {};
  const agentConfigs = opts.agentConfigs ?? [];
  const registeredSet = new Set(opts.registeredProviderIds ?? []);

  const registerMock = vi.fn((id: string) => { registeredSet.add(id); });
  const hasMock = vi.fn((id: string) => registeredSet.has(id));
  const updateConfigMock = vi.fn();
  const getConfigMock = vi.fn((): RouterConfig => ({
    default: { providerId: 'openai', model: 'gpt-4o', options: {} },
    fallback: {
      fallbacks: [],
      conditions: { maxConsecutiveFailures: 3, timeoutThreshold: 60_000 },
      recoveryCheckIntervalMs: 300_000,
    },
  }));

  const configManager = {
    getProviderConfigs: vi.fn().mockResolvedValue(providerConfigs),
  } as unknown as Parameters<typeof bootstrapLlmSystem>[0]['configManager'];

  const providerRegistry = {
    has: hasMock,
    register: registerMock,
  } as unknown as Parameters<typeof bootstrapLlmSystem>[0]['providerRegistry'];

  const modelRouter = {
    getConfig: getConfigMock,
    updateConfig: updateConfigMock,
  } as unknown as Parameters<typeof bootstrapLlmSystem>[0]['modelRouter'];

  const agentConfigManager = {
    list: vi.fn().mockResolvedValue(
      agentConfigs.map(c => ({ id: c.id!, name: c.name, status: 'offline' as const, toolCount: 0 })),
    ),
    get: vi.fn().mockImplementation(async (id: string) =>
      agentConfigs.find(c => c.id === id),
    ),
  } as unknown as Parameters<typeof bootstrapLlmSystem>[0]['agentConfigManager'];

  return {
    configManager,
    providerRegistry,
    modelRouter,
    agentConfigManager,
    registerMock,
    hasMock,
    updateConfigMock,
    getConfigMock,
  };
}

// ═══════════════════════════════════════════════════════════
// 测试用例
// ═══════════════════════════════════════════════════════════

describe('bootstrapLlmSystem', () => {
  // ───────────────────────────────────────────────────────
  // 1. Provider 注册
  // ───────────────────────────────────────────────────────
  describe('Provider 注册', () => {
    it('getProviderConfigs 返回多个 → 逐个 register 到 providerRegistry', async () => {
      const m = buildMocks({
        providerConfigs: {
          openai: makeProviderConfig('https://api.openai.com/v1', 'gpt-4o'),
          claude: makeProviderConfig('https://api.anthropic.com/v1', 'claude-3-5-sonnet'),
        },
      });

      const result = await bootstrapLlmSystem({
        configManager: m.configManager,
        providerRegistry: m.providerRegistry,
        modelRouter: m.modelRouter,
        agentConfigManager: m.agentConfigManager,
      });

      expect(result.registeredProviders).toEqual(['openai', 'claude']);
      expect(result.skippedProviders).toEqual([]);
      expect(m.registerMock).toHaveBeenCalledTimes(2);
      expect(m.registerMock).toHaveBeenCalledWith('openai', expect.any(OpenAIProvider));
      expect(m.registerMock).toHaveBeenCalledWith('claude', expect.any(ClaudeProvider));
    });

    it('providerConfig 缺 baseUrl 时跳过该 provider 且不抛错', async () => {
      const m = buildMocks({
        providerConfigs: {
          bad: { baseUrl: '', apiKey: 'k', defaultModel: 'm' },
          good: makeProviderConfig('https://api.openai.com/v1'),
        },
      });

      const result = await bootstrapLlmSystem({
        configManager: m.configManager,
        providerRegistry: m.providerRegistry,
        modelRouter: m.modelRouter,
        agentConfigManager: m.agentConfigManager,
      });

      expect(result.registeredProviders).toEqual(['good']);
      expect(m.registerMock).toHaveBeenCalledTimes(1);
    });
  });

  // ───────────────────────────────────────────────────────
  // 2. 幂等
  // ───────────────────────────────────────────────────────
  describe('幂等', () => {
    it('已注册的 Provider 第二次调用时跳过', async () => {
      const m = buildMocks({
        providerConfigs: {
          openai: makeProviderConfig('https://api.openai.com/v1'),
        },
        registeredProviderIds: ['openai'], // 已注册
      });

      const result = await bootstrapLlmSystem({
        configManager: m.configManager,
        providerRegistry: m.providerRegistry,
        modelRouter: m.modelRouter,
        agentConfigManager: m.agentConfigManager,
      });

      expect(result.registeredProviders).toEqual([]);
      expect(result.skippedProviders).toEqual(['openai']);
      expect(m.registerMock).not.toHaveBeenCalled();
      // has 被调用了 1 次
      expect(m.hasMock).toHaveBeenCalledWith('openai');
    });
  });

  // ───────────────────────────────────────────────────────
  // 3. workspace 路由配置
  // ───────────────────────────────────────────────────────
  describe('workspace 路由配置', () => {
    it('agentConfig.mainModel → modelRouter.updateConfig 的 workspaces', async () => {
      const m = buildMocks({
        agentConfigs: [
          makeAgentConfig('a1', { providerId: 'openai', modelName: 'gpt-4o', workspaceId: 'ws-1' }),
          makeAgentConfig('a2', { providerId: 'claude', modelName: 'claude-3-5-sonnet', workspaceId: 'ws-2' }),
        ],
      });

      const result = await bootstrapLlmSystem({
        configManager: m.configManager,
        providerRegistry: m.providerRegistry,
        modelRouter: m.modelRouter,
        agentConfigManager: m.agentConfigManager,
      });

      expect(result.workspaceRoutes).toMatchObject({
        'ws-1': { providerId: 'openai', model: 'gpt-4o' },
        'ws-2': { providerId: 'claude', model: 'claude-3-5-sonnet' },
      });
      expect(m.updateConfigMock).toHaveBeenCalledTimes(1);
      const updateArg = m.updateConfigMock.mock.calls[0]![0];
      expect(updateArg.workspaces).toMatchObject({
        'ws-1': { providerId: 'openai' },
        'ws-2': { providerId: 'claude' },
      });
    });

    it('缺 mainModel.providerId 的 agent 被跳过', async () => {
      const bad = makeAgentConfig('bad');
      bad.llmConfig.mainModel = { providerId: '', modelId: 'm', modelName: 'm' };
      const m = buildMocks({ agentConfigs: [bad] });

      const result = await bootstrapLlmSystem({
        configManager: m.configManager,
        providerRegistry: m.providerRegistry,
        modelRouter: m.modelRouter,
        agentConfigManager: m.agentConfigManager,
      });

      expect(result.skippedAgents).toEqual(['bad']);
      expect(result.workspaceRoutes).toEqual({});
    });

    it('缺 mainModel.modelName 的 agent 被跳过', async () => {
      const bad = makeAgentConfig('bad');
      bad.llmConfig.mainModel = { providerId: 'openai', modelId: '', modelName: '' };
      const m = buildMocks({ agentConfigs: [bad] });

      const result = await bootstrapLlmSystem({
        configManager: m.configManager,
        providerRegistry: m.providerRegistry,
        modelRouter: m.modelRouter,
        agentConfigManager: m.agentConfigManager,
      });

      expect(result.skippedAgents).toEqual(['bad']);
    });

    it('workspaceId 缺省时落到 default key', async () => {
      const agent = makeAgentConfig('a1');
      delete agent.workspaceId;
      const m = buildMocks({ agentConfigs: [agent] });

      const result = await bootstrapLlmSystem({
        configManager: m.configManager,
        providerRegistry: m.providerRegistry,
        modelRouter: m.modelRouter,
        agentConfigManager: m.agentConfigManager,
      });

      expect(result.workspaceRoutes).toHaveProperty('default');
      // default 路由也应被设为 updateConfig 的 default
      const updateArg = m.updateConfigMock.mock.calls[0]![0];
      expect(updateArg.default).toMatchObject({ providerId: 'openai' });
    });
  });

  // ───────────────────────────────────────────────────────
  // 4. resolveProviderClass 4 分支推断
  // ───────────────────────────────────────────────────────
  describe('resolveProviderClass 类型推断', () => {
    it('anthropic.com → ClaudeProvider', () => {
      expect(resolveProviderClass('https://api.anthropic.com/v1')).toBe(ClaudeProvider);
    });

    it('generativelanguage.googleapis.com → GeminiProvider', () => {
      expect(resolveProviderClass('https://generativelanguage.googleapis.com/v1beta')).toBe(GeminiProvider);
    });

    it('包含 gemini → GeminiProvider', () => {
      expect(resolveProviderClass('https://gemini.example.com/v1')).toBe(GeminiProvider);
    });

    it(':11434 → OllamaProvider', () => {
      expect(resolveProviderClass('http://127.0.0.1:11434')).toBe(OllamaProvider);
    });

    it('包含 ollama → OllamaProvider', () => {
      expect(resolveProviderClass('https://my-ollama-host/v1')).toBe(OllamaProvider);
    });

    it('openai.com → OpenAIProvider', () => {
      expect(resolveProviderClass('https://api.openai.com/v1')).toBe(OpenAIProvider);
    });

    it('deepseek / qwen / moonshot 等兼容接口 → OpenAIProvider', () => {
      expect(resolveProviderClass('https://api.deepseek.com/v1')).toBe(OpenAIProvider);
      expect(resolveProviderClass('https://dashscope.aliyuncs.com/compatible-mode/v1')).toBe(OpenAIProvider);
      expect(resolveProviderClass('https://api.moonshot.cn/v1')).toBe(OpenAIProvider);
    });

    it('空字符串 → OpenAIProvider（兜底）', () => {
      expect(resolveProviderClass('')).toBe(OpenAIProvider);
    });

    it('大小写不敏感', () => {
      expect(resolveProviderClass('HTTPS://API.ANTHROPIC.COM/v1')).toBe(ClaudeProvider);
      expect(resolveProviderClass('https://API.OLLAMA.example')).toBe(OllamaProvider);
    });
  });
});
