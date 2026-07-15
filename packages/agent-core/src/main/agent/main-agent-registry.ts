/**
 * V20 §4.9 MainAgentRegistry — (workspaceId, agentId) → MainAgent 实例缓存与查找
 *
 * 核心职责：
 * 1. 按 (workspaceId, agentId) 构造并缓存 MainAgent 实例
 * 2. 提供 async get()（首次需读 AgentConfig）与 sync getSync()（仅查缓存）
 * 3. agent 配置变更时通过 refresh(agentId) 失效缓存
 * 4. list() 列出当前缓存内的所有 (workspaceId, agentId)
 *
 * 设计要点（与 §3.2 Step 3 / §2.2 决策对齐）：
 * - 每 agent 独立 pipeline 实例（避免 dispatcher/collector 状态串扰）
 * - promptBuilder 每 agent 一个（避免并发 handle 调用 updateProfile 互踩）
 * - connectionResolver / modelRouter / historyStore / scheduler / observer 跨 agent 共享
 * - 同步缓存策略：首次 get() 异步构造完成后填入 cache；trigger 第二次触发时 getSync() 即可命中
 *
 * 集成方式：
 * ```ts
 * const registry = new MainAgentRegistry({ ... });
 * // 注入到 TriggerEngine 的 ActionExecutor
 * actionExecutor.setDeps({
 *   mainAgentProvider: (p) => registry.getSync(p.workspaceId, p.agentId),
 *   resolveTarget: resolveTargetFactory(agentConfigManager),
 * });
 * ```
 */

import type { AgentConfig } from '../../renderer/src/lib/types';
import type { AgentConfigManager } from './agent-config-manager';
import type { ConnectionResolver } from './connection-resolver';
import type { PromptBuilder } from '../prompt/builder/prompt-builder';
import type { FunctionCallingPipeline } from '../pipeline/pipeline';
import type { IModelRouter, IProviderRegistry, ILLMObserver } from '../llm/types';
import type { LlmRequestScheduler } from '../llm/scheduler/types';
import type { ChatHistoryStore } from '../chat-history/chat-history-store';
import type { ToolRegistry } from '../workspace/tool-registry';

import { MainAgent } from './main-agent';
import { BatchToolDispatcher } from '../pipeline/batch-tool-dispatcher';
import { BatchResultCollector } from '../pipeline/batch-result-collector';

/** Registry 依赖（由 ipc/index.ts 启动时注入） */
export interface MainAgentRegistryDeps {
  agentConfigManager: AgentConfigManager;
  /** workspaceManager.toolRegistry（共享） */
  toolRegistry: ToolRegistry;
  /** 共享模型路由器（由 bootstrap 配置 workspace 路由） */
  modelRouter: IModelRouter;
  providerRegistry: IProviderRegistry;
  /** 共享连接解析器（MainAgent 内部 pipeline 的 dispatcher 持有） */
  connectionResolver: ConnectionResolver;
  historyStore: ChatHistoryStore;
  scheduler: LlmRequestScheduler;
  observer: ILLMObserver;
  /** 每 agent 独立 pipeline 工厂 */
  pipelineFactory: () => FunctionCallingPipeline;
  /** PromptBuilder 工厂（每 agent 独立实例） */
  promptBuilderFactory: (toolRegistry: ToolRegistry) => PromptBuilder;
  /** 多轮迭代上限，默认 5 */
  maxRounds?: number;
}

/** list() 返回项 */
export interface RegistryEntry {
  workspaceId: string;
  agentId: string;
}

const DEFAULT_MAX_ROUNDS = 5;

export class MainAgentRegistry {
  /** cache key = `${workspaceId}:${agentId}` → MainAgent */
  private readonly cache = new Map<string, MainAgent>();
  /** agentId → cache key 反向索引（供 refresh(agentId) 使用） */
  private readonly agentIndex = new Map<string, string>();
  /** 异步构造 in-flight 标记，避免并发重复构造 */
  private readonly inflight = new Map<string, Promise<MainAgent | undefined>>();
  private readonly deps: MainAgentRegistryDeps;

  constructor(deps: MainAgentRegistryDeps) {
    this.deps = deps;
  }

  /**
   * 异步获取 MainAgent：未命中则读 AgentConfig → 构造 → 缓存。
   * 并发同 key 调用时复用 in-flight Promise。
   */
  async get(workspaceId: string, agentId: string): Promise<MainAgent | undefined> {
    const key = makeKey(workspaceId, agentId);

    // 1. 同步缓存命中
    const cached = this.cache.get(key);
    if (cached) return cached;

    // 2. 异步构造 in-flight 命中
    const inflight = this.inflight.get(key);
    if (inflight) return inflight;

    // 3. 启动异步构造
    const p = (async () => {
      try {
        const agentConfig = await this.deps.agentConfigManager.get(agentId);
        if (!agentConfig) return undefined;

        // 校验：缺 llmConfig 直接跳过（spec §4 风险表）
        if (!agentConfig.llmConfig?.mainModel?.providerId) return undefined;

        const agent = this.constructAgent(workspaceId, agentId, agentConfig);
        this.cache.set(key, agent);
        this.agentIndex.set(agentId, key);
        return agent;
      } catch (err) {
        console.warn(
          `[MainAgentRegistry] 构造 MainAgent 失败 (${key}):`,
          err instanceof Error ? err.message : err,
        );
        return undefined;
      } finally {
        this.inflight.delete(key);
      }
    })();

    this.inflight.set(key, p);
    return p;
  }

  /**
   * 同步获取：仅查缓存，不触发构造。
   *
   * 给 TriggerEngine 的 mainAgentProvider 用（同步签名）。
   * 首次 trigger 触发时可能返回 undefined，trigger 下次再触发时已异步构造好。
   */
  getSync(workspaceId: string, agentId: string): MainAgent | undefined {
    return this.cache.get(makeKey(workspaceId, agentId));
  }

  /**
   * 失效指定 agentId 的缓存（agent 配置变更后调用）。
   * 不区分 workspaceId —— 假设 agentId 全局唯一。
   */
  refresh(agentId: string): void {
    const key = this.agentIndex.get(agentId);
    if (!key) return;
    this.cache.delete(key);
    this.agentIndex.delete(agentId);
  }

  /** 失效指定 (workspaceId, agentId) 的缓存 */
  invalidate(workspaceId: string, agentId: string): void {
    const key = makeKey(workspaceId, agentId);
    this.cache.delete(key);
    this.agentIndex.delete(agentId);
  }

  /** 列出当前缓存内的所有 (workspaceId, agentId) */
  list(): RegistryEntry[] {
    const out: RegistryEntry[] = [];
    for (const key of this.cache.keys()) {
      const [workspaceId, agentId] = key.split(':');
      out.push({ workspaceId, agentId });
    }
    return out;
  }

  /** 清空所有缓存（测试 / 热重载用） */
  clear(): void {
    this.cache.clear();
    this.agentIndex.clear();
    this.inflight.clear();
  }

  // ════════════════════════════════════════════════════════════
  // 内部辅助
  // ════════════════════════════════════════════════════════════

  /**
   * 构造一个 MainAgent 实例（含独立 pipeline + promptBuilder）。
   *
   * MainAgent / BatchToolDispatcher / BatchResultCollector 均通过顶部静态 import 引入，
   * 实测无循环依赖（main-agent.ts 不反向引用 registry）。
   */
  private constructAgent(
    workspaceId: string,
    agentId: string,
    agentConfig: AgentConfig,
  ): MainAgent {
    // 独立 pipeline + 注入 dispatcher/collector
    const pipeline = this.deps.pipelineFactory();
    pipeline.setDispatcher(new BatchToolDispatcher(this.deps.connectionResolver));
    pipeline.setCollector(new BatchResultCollector());

    // 独立 promptBuilder
    const promptBuilder = this.deps.promptBuilderFactory(this.deps.toolRegistry);

    return new MainAgent({
      agentConfig,
      workspaceId,
      agentId,
      toolRegistry: this.deps.toolRegistry,
      promptBuilder,
      modelRouter: this.deps.modelRouter,
      providerRegistry: this.deps.providerRegistry,
      pipeline,
      connectionResolver: this.deps.connectionResolver,
      historyStore: this.deps.historyStore,
      scheduler: this.deps.scheduler,
      observer: this.deps.observer,
      maxRounds: this.deps.maxRounds ?? DEFAULT_MAX_ROUNDS,
    });
  }
}

/** 拼 cache key */
function makeKey(workspaceId: string, agentId: string): string {
  return `${workspaceId}:${agentId}`;
}
