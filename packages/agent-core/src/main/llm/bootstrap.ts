/**
 * V20 §4.5 主链路组装 — bootstrapLlmSystem
 *
 * 启动时把 LLM 子系统拼装成可用状态：
 * 1. 从 DefaultLLMConfigManager 加载所有 ProviderConfig
 * 2. 按 baseUrl 推断 Provider 类型（anthropic / googleapis / ollama / OpenAI 兼容）
 * 3. 实例化 Provider 并注册到 ProviderRegistry（幂等，已注册的跳过）
 * 4. 加载所有 AgentConfig，按 workspaceId 配置 ModelRouter 的 workspace 路由
 *
 * 触发时机（由 ipc/index.ts 调用）：
 * - 应用启动 registerAllIpcHandlers 之前
 * - provider:create / provider:update / provider:delete 后增量重跑
 * - agent:create / agent:update 后增量重跑（仅刷新 Router 配置）
 *
 * 注意：V20 阶段 qqBotModel / compressionModel 不通过 ModelRouter 区分；
 * MainAgent 直接从 AgentConfig.llmConfig 按 event.source 选 providerId。
 * ModelRouter 仅承担 workspace → mainModel 的路由职责。
 */

import type { DefaultLLMConfigManager } from './config/config-manager';
import type { ProviderRegistry } from './registry/provider-registry';
import type { DefaultModelRouter } from './router/model-router';
import type { AgentConfigManager } from '../agent/agent-config-manager';
import type { ProviderConfig, ResolvedModel, RouterConfig, LLMProvider } from './types';

import { OpenAIProvider } from './providers/openai';
import { ClaudeProvider } from './providers/claude';
import { GeminiProvider } from './providers/gemini';
import { OllamaProvider } from './providers/ollama';

/** Provider 构造函数类型（具体子类，避免抽象类不能 new 的类型错误） */
type ProviderConstructor = new (config: ProviderConfig) => LLMProvider;

/** Bootstrap 依赖 */
export interface BootstrapDeps {
  configManager: DefaultLLMConfigManager;
  providerRegistry: ProviderRegistry;
  modelRouter: DefaultModelRouter;
  agentConfigManager: AgentConfigManager;
}

/** Bootstrap 返回结果 */
export interface BootstrapResult {
  /** 本次注册的 Provider id 列表（不含已注册的） */
  registeredProviders: string[];
  /** 配置到 ModelRouter 的 workspace 路由（workspaceId → ResolvedModel） */
  workspaceRoutes: Record<string, ResolvedModel>;
  /** 跳过的 Provider id（已注册） */
  skippedProviders: string[];
  /** 跳过的 Agent id（缺 llmConfig.mainModel） */
  skippedAgents: string[];
}

/**
 * 启动时引导 LLM 子系统：注册 Provider + 配置 Router。
 *
 * 幂等：重复调用不会重复注册 Provider，只会刷新 Router 配置。
 */
export async function bootstrapLlmSystem(deps: BootstrapDeps): Promise<BootstrapResult> {
  const { configManager, providerRegistry, modelRouter, agentConfigManager } = deps;

  // ── 1. 加载并注册 Provider ──
  const providerConfigs = await configManager.getProviderConfigs();
  const registeredProviders: string[] = [];
  const skippedProviders: string[] = [];

  for (const [providerId, cfg] of Object.entries(providerConfigs)) {
    if (providerRegistry.has(providerId)) {
      skippedProviders.push(providerId);
      continue;
    }
    try {
      const ProviderCls = resolveProviderClass(cfg.baseUrl);
      const provider = new ProviderCls(normalizeProviderConfig(providerId, cfg));
      providerRegistry.register(providerId, provider);
      registeredProviders.push(providerId);
    } catch (err) {
      console.warn(
        `[bootstrapLlmSystem] 注册 Provider '${providerId}' 失败:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  // ── 2. 加载 AgentConfig → 配置 ModelRouter workspace 路由 ──
  const agentSummaries = await agentConfigManager.list();
  const workspaceRoutes: Record<string, ResolvedModel> = {};
  const skippedAgents: string[] = [];

  for (const summary of agentSummaries) {
    const cfg = await agentConfigManager.get(summary.id);
    if (!cfg) {
      skippedAgents.push(summary.id);
      continue;
    }
    const mainModel = cfg.llmConfig?.mainModel;
    if (!mainModel?.providerId || !mainModel?.modelName) {
      skippedAgents.push(summary.id);
      continue;
    }
    // V20 FIX: 空字符串 '' 也是合法的 workspaceId，不要用 'default' 替代
    const wsKey = cfg.workspaceId || 'default';
    // 同一 workspace 多个 agent 时后者覆盖前者；正常情况下每 workspace 一个 main agent
    workspaceRoutes[wsKey] = {
      providerId: mainModel.providerId,
      model: mainModel.modelName,
      options: {
        temperature: 0.7,
        maxTokens: 4096,
        timeout: 60_000,
        retryCount: 3,
      },
    };
  }

  // ── 3. 更新 ModelRouter 配置（保留原 fallback 不动） ──
  const currentConfig = modelRouter.getConfig();
  const defaultRoute =
    workspaceRoutes['default'] ?? currentConfig.default;
  const newConfig: Partial<RouterConfig> = {
    default: defaultRoute,
    workspaces: { ...workspaceRoutes },
    // fallback 保持原样
  };
  modelRouter.updateConfig(newConfig);

  console.info(
    `[bootstrapLlmSystem] 完成：注册 ${registeredProviders.length} 个 Provider，` +
      `配置 ${Object.keys(workspaceRoutes).length} 个 workspace 路由` +
      (skippedProviders.length ? `，跳过 ${skippedProviders.length} 个已注册 Provider` : '') +
      (skippedAgents.length ? `，跳过 ${skippedAgents.length} 个配置不全的 Agent` : ''),
  );

  return {
    registeredProviders,
    workspaceRoutes,
    skippedProviders,
    skippedAgents,
  };
}

/**
 * 按 baseUrl 推断 Provider 类型。
 *
 * 推断规则（按优先级）：
 * 1. anthropic.com → ClaudeProvider
 * 2. generativelanguage.googleapis.com / 包含 gemini → GeminiProvider
 * 3. 127.0.0.1:11434 / 包含 ollama → OllamaProvider
 * 4. 其他（含 openai.com / deepseek / qwen / moonshot / zhipu 等） → OpenAIProvider（兼容接口）
 */
export function resolveProviderClass(baseUrl: string): ProviderConstructor {
  const u = (baseUrl ?? '').toLowerCase();
  if (u.includes('anthropic.com')) return ClaudeProvider;
  if (u.includes('generativelanguage.googleapis.com') || u.includes('gemini')) {
    return GeminiProvider;
  }
  if (u.includes(':11434') || u.includes('ollama')) return OllamaProvider;
  return OpenAIProvider;
}

/**
 * 规整 ProviderConfig：补全必填字段，确保 baseUrl 去尾斜杠。
 *
 * BaseProvider 构造函数会再次去尾斜杠，但这里先规整一遍便于日志展示。
 */
function normalizeProviderConfig(providerId: string, cfg: ProviderConfig): ProviderConfig {
  if (!cfg.baseUrl) {
    throw new Error(`ProviderConfig '${providerId}' 缺 baseUrl`);
  }
  if (!cfg.defaultModel) {
    throw new Error(`ProviderConfig '${providerId}' 缺 defaultModel`);
  }
  return {
    ...cfg,
    baseUrl: cfg.baseUrl.replace(/\/+$/, ''),
    timeout: cfg.timeout ?? 60_000,
    maxRetries: cfg.maxRetries ?? 3,
  };
}
