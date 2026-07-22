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
import type { Orchestrator, MainAgentHandle } from '../orchestration/orchestrator';
import type { MiddlewareContext } from '../pipeline/types';

import { MainAgent } from './main-agent';
import { BatchToolDispatcher } from '../pipeline/batch-tool-dispatcher';
import { BatchResultCollector } from '../pipeline/batch-result-collector';
import { NOTIFY_QQ_TOOL_SCHEMA } from '../qq-bot/tools/notify_qq';
import { WIKI_TOOL_SCHEMAS, wikiSearch, wikiGetPage, wikiGetSection, getWikiClient } from '../wiki';
import { SEARCH_TOOL_SCHEMAS, webSearch, webFetch, getSearchClient } from '../search';
import { MEMORY_TOOL_SCHEMAS } from '../memory/tools';
import { TASK_TOOL_SCHEMAS, getTaskManager } from '../task';
import { UPDATE_PLAN_TOOL } from '../orchestration/tools/update-plan';
import { getMemoryManager } from '../ipc/memory-handler';
import { ToolCategory, type ToolSchema, type ParamDefinition } from '@mcagent/shared';
import { StickerGroupRegistry } from '../qq-bot/sticker-group-registry';
import { getWorkspaceManager } from '../workspace';

// ════════════════════════════════════════════════════════════════
// V30: qq_send / qq_info 工具定义（ToolSchema 格式）
// ════════════════════════════════════════════════════════════════

/** qq_send 工具定义 */
const QQ_SEND_TOOL_SCHEMA_LOCAL: ToolSchema = {
  name: 'qq_send',
  description: '发送 QQ 消息，支持群消息、私聊、图片、文件、内置表情、表情组六种方式。当需要向 QQ 群或用户发送消息时使用此工具。回复用户消息时必须使用此工具。',
  category: ToolCategory.QQ,
  parameters: {
    type: { type: 'string', description: '发送类型：group_msg=发送到群聊（回复群消息时用）, private_msg=发送私聊（回复私聊时用）, image=发送图片, file=发送文件, face=发送指定内置表情（需填 face_id）, sticker=发送表情组（系统随机选，需填 sticker_group）', required: true } as ParamDefinition,
    target: { type: 'string', description: '目标 ID：群聊时填群号，私聊时填对方 QQ 号', required: true } as ParamDefinition,
    content: { type: 'string', description: '消息内容（type=group_msg 或 private_msg 时必填，纯文本消息内容）', required: false } as ParamDefinition,
    file_url: { type: 'string', description: '文件/图片 URL（type=image 或 file 时必填，文件的网络可访问 URL）', required: false } as ParamDefinition,
    file_name: { type: 'string', description: '文件名（type=file 时必填，如 "screenshot.png"）', required: false } as ParamDefinition,
    face_id: { type: 'number', description: '内置表情 ID（type=face 时必填，范围 0-350，如 9=偷笑, 76=点赞, 107=流泪, 307=裂开）', required: false } as ParamDefinition,
    sticker_group: { type: 'string', description: '表情组名（type=sticker 时必填，如 "蚌"/"赞"/"哭"/"嗨"），系统从组内随机选一个表情发送', required: false } as ParamDefinition,
  },
};

/** qq_info 工具定义 */
const QQ_INFO_TOOL_SCHEMA_LOCAL: ToolSchema = {
  name: 'qq_info',
  description: '查询 QQ 群信息、群成员列表或用户信息',
  category: ToolCategory.QQ,
  parameters: {
    type: { type: 'string', description: '查询类型：group=群信息, members=群成员, user=用户信息', required: true } as ParamDefinition,
    target_id: { type: 'string', description: '目标 ID（群号或 QQ 号）', required: true } as ParamDefinition,
  },
};

/** request_game_action 工具定义 */
const REQUEST_GAME_ACTION_TOOL_SCHEMA_LOCAL: ToolSchema = {
  name: 'request_game_action',
  description: '请求主 Agent 执行游戏内的操作。当 QQ 用户需要查询游戏状态、执行游戏指令或进行任何游戏内操作时使用此工具。',
  category: ToolCategory.QQ,
  parameters: {
    description: { type: 'string', description: '对用户请求的自然语言描述，包含所有必要信息，主 Agent 将据此理解并执行', required: true } as ParamDefinition,
    priority: { type: 'string', description: '优先级：normal=普通, high=紧急（如玩家遇险）', required: false } as ParamDefinition,
  },
};

/** V31: 待发送的 QQ 消息队列条目（支持 face 和 sticker 类型） */
export interface PendingQqSend {
  target: string;
  content: string;
  type: string;
  faceId?: number;     // type=face 时具体表情 ID
  stickerId?: string;  // type=sticker 时具体贴图 ID
}

/** V30: 待发送的 QQ 消息队列（key = agentId, value = 待发送消息） */
export const pendingQqSends = new Map<string, PendingQqSend[]>();

/** V31: 全局表情组注册表单例 */
export const stickerGroupRegistry = new StickerGroupRegistry();

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
  /** V22：Orchestrator 工厂（每 agent 独立实例，包装 MainAgent） */
  orchestratorFactory?: (mainAgent: MainAgent) => Orchestrator;
  /** 多轮迭代上限，默认 5 */
  maxRounds?: number;
  /**
   * V33: 流式事件发射器（可选）
   * 每 agent 构造时注入，emit 事件供前端实时显示 LLM 输出。
   */
  streamEmitter?: (event: { type: 'thinking' | 'text' | 'tool_calls' | 'done'; data?: unknown }) => void;
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
  /** V22：cache key → Orchestrator（与 MainAgent 1:1 绑定） */
  private readonly orchCache = new Map<string, Orchestrator>();
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

        // V22：同步创建 Orchestrator（1:1 绑定）
        if (this.deps.orchestratorFactory) {
          const orch = this.deps.orchestratorFactory(agent);
          this.orchCache.set(key, orch);
        }

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
   * V22：同步获取 Orchestrator（仅查缓存）。
   *
   * 若 orchestratorFactory 未配置或 Orchestrator 尚未构造，返回 undefined。
   * ActionExecutor 优先使用此方法；fallback 到 getSync。
   */
  getOrchestratorSync(workspaceId: string, agentId: string): Orchestrator | undefined {
    return this.orchCache.get(makeKey(workspaceId, agentId));
  }

  /**
   * 失效指定 agentId 的缓存（agent 配置变更后调用）。
   * 不区分 workspaceId —— 假设 agentId 全局唯一。
   */
  refresh(agentId: string): void {
    const key = this.agentIndex.get(agentId);
    if (!key) return;
    this.cache.delete(key);
    this.orchCache.delete(key);
    this.agentIndex.delete(agentId);
  }

  /** 失效指定 (workspaceId, agentId) 的缓存 */
  invalidate(workspaceId: string, agentId: string): void {
    const key = makeKey(workspaceId, agentId);
    this.cache.delete(key);
    this.orchCache.delete(key);
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
    this.orchCache.clear();
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
   *
   * V27: 注册 notify_qq 本地工具 + 添加 Pipeline 中间件处理本地调用。
   */
  private constructAgent(
    workspaceId: string,
    agentId: string,
    agentConfig: AgentConfig,
  ): MainAgent {
    // V27: 注册 notify_qq 本地工具（供 LLM 可见）
    // V30: 同时注册 qq_send / qq_info / request_game_action 工具
    //       以及内置工具（Wiki / 搜索 / 记忆 / 任务 / 编排），使其不依赖 workspace 连接即可用
    this.deps.toolRegistry.registerLocal(workspaceId, [
      NOTIFY_QQ_TOOL_SCHEMA,
      QQ_SEND_TOOL_SCHEMA_LOCAL,
      QQ_INFO_TOOL_SCHEMA_LOCAL,
      REQUEST_GAME_ACTION_TOOL_SCHEMA_LOCAL,
      ...WIKI_TOOL_SCHEMAS,
      ...SEARCH_TOOL_SCHEMAS,
      ...MEMORY_TOOL_SCHEMAS,
      ...TASK_TOOL_SCHEMAS,
      UPDATE_PLAN_TOOL,
    ]);

    // 独立 pipeline + 注入 dispatcher/collector
    const pipeline = this.deps.pipelineFactory();
    pipeline.setDispatcher(new BatchToolDispatcher(this.deps.connectionResolver));
    pipeline.setCollector(new BatchResultCollector());

    // V27: 添加 notify_qq 本地处理器中间件
    // V30: 添加 qq_send / qq_info 本地处理器中间件
    pipeline.use({
      name: 'notify_qq_handler',
      before: async (ctx: MiddlewareContext): Promise<MiddlewareContext> => {
        const notifyCalls = ctx.calls.filter((c) => c.toolName === 'notify_qq');
        if (notifyCalls.length === 0) return ctx;

        // 找出当前 workspace 下的 QQ Agent
        const qqAgent = this.findQQAgent(workspaceId);
        if (!qqAgent) {
          // 无 QQ Agent，所有 notify_qq 调用标记失败
          for (const call of notifyCalls) {
            ctx.results = ctx.results ?? [];
            ctx.results.push({
              type: 'tool_result',
              toolCallId: call.toolCallId,
              toolName: 'notify_qq',
              success: false,
              error: '未找到绑定的 QQ Agent，无法发送通知',
              durationMs: 0,
            } as any);
          }
          ctx.calls = ctx.calls.filter((c) => c.toolName !== 'notify_qq');
          return ctx;
        }

        // 处理每个 notify_qq 调用
        for (const call of notifyCalls) {
          const startTime = Date.now();
          const params = call.arguments as Record<string, unknown>;
          const content = params.content as string;
          const target = params.target as string | undefined;

          try {
            // 调用 QQAgent.sendQQMessage()
            const result = await (qqAgent as any).sendQQMessage(
              target ?? '',
              content,
              'group',
            );

            ctx.results = ctx.results ?? [];
            ctx.results.push({
              type: 'tool_result',
              toolCallId: call.toolCallId,
              toolName: 'notify_qq',
              success: result,
              data: result ? { message: '通知已发送' } : undefined,
              error: result ? undefined : '发送通知失败',
              durationMs: Date.now() - startTime,
            } as any);
          } catch (err) {
            ctx.results = ctx.results ?? [];
            ctx.results.push({
              type: 'tool_result',
              toolCallId: call.toolCallId,
              toolName: 'notify_qq',
              success: false,
              error: err instanceof Error ? err.message : '发送通知异常',
              durationMs: Date.now() - startTime,
            } as any);
          }
        }

        // 从 pipeline 调度中移除所有 notify_qq 调用（已本地处理）
        ctx.calls = ctx.calls.filter((c) => c.toolName !== 'notify_qq');
        return ctx;
      },
    });

    // V30: qq_send / qq_info / request_game_action 本地处理器中间件
    pipeline.use({
      name: 'qq_send_handler',
      before: async (ctx: MiddlewareContext): Promise<MiddlewareContext> => {
        const qqSendCalls = ctx.calls.filter((c) => c.toolName === 'qq_send');
        const qqInfoCalls = ctx.calls.filter((c) => c.toolName === 'qq_info');
        const gameActionCalls = ctx.calls.filter((c) => c.toolName === 'request_game_action');
        if (qqSendCalls.length === 0 && qqInfoCalls.length === 0 && gameActionCalls.length === 0) return ctx;

        // V31: 处理 qq_send 调用（含去重 + 表情组随机解析）
        const dedupSet = new Set<string>();
        for (const call of qqSendCalls) {
          const startTime = Date.now();
          const params = call.arguments as Record<string, unknown>;
          const sendType = params.type as string;
          const target = params.target as string;

          const content = (params.content as string) ?? '';
          let resolvedType = sendType;
          let faceId: number | undefined;
          let stickerId: string | undefined;
          let errorMsg: string | undefined;

          if (sendType === 'face') {
            // 内置表情：直接取 face_id
            faceId = params.face_id as number | undefined;
            if (faceId === undefined) {
              errorMsg = '发送内置表情时必须指定 face_id';
            }
          } else if (sendType === 'sticker') {
            // 表情组：从 StickerGroupRegistry 随机选一个
            const groupName = params.sticker_group as string | undefined;
            if (!groupName) {
              const availableGroups = stickerGroupRegistry.listGroups();
              errorMsg = `表情组名不能为空，可用组名：${availableGroups.join('、')}`;
            } else {
              const picked = stickerGroupRegistry.pickRandom(groupName);
              if (!picked) {
                const availableGroups = stickerGroupRegistry.listGroups();
                errorMsg = `表情组 "${groupName}" 不存在，可用组名：${availableGroups.join('、')}`;
              } else {
                // 根据随机结果确定具体类型和 ID
                resolvedType = picked.type;
                if (picked.type === 'face') {
                  faceId = parseInt(picked.id);
                } else {
                  stickerId = picked.id;
                }
              }
            }
          }

          // 参数校验失败
          if (errorMsg) {
            ctx.results = ctx.results ?? [];
            ctx.results.push({
              type: 'tool_result',
              toolCallId: call.toolCallId,
              toolName: 'qq_send',
              success: false,
              error: errorMsg,
              durationMs: Date.now() - startTime,
            } as any);
            continue;
          }

          // 去重检查（表情按 target:type:id 去重）
          const dedupKey = sendType === 'group_msg' || sendType === 'private_msg'
            ? `${target}:${content}`
            : `${target}:${resolvedType}:${faceId ?? stickerId ?? ''}`;
          if (dedupSet.has(dedupKey)) {
            console.log(`[MainAgentRegistry] qq_send 去重: type=${sendType}, target=${target}`);
            ctx.results = ctx.results ?? [];
            ctx.results.push({
              type: 'tool_result',
              toolCallId: call.toolCallId,
              toolName: 'qq_send',
              success: true,
              data: { message: '消息已加入发送队列（去重，实际未发送）' },
              durationMs: Date.now() - startTime,
            } as any);
            continue;
          }
          dedupSet.add(dedupKey);

          // 存入待发送队列（由 message-router / message-batcher 消费）
          const pending = pendingQqSends.get(agentId) ?? [];
          pending.push({ target, content, type: resolvedType, faceId, stickerId });
          pendingQqSends.set(agentId, pending);

          console.log(`[MainAgentRegistry] qq_send 已排队: type=${resolvedType}, target=${target}${faceId !== undefined ? `, faceId=${faceId}` : ''}${stickerId ? `, stickerId=${stickerId}` : ''}`);

          ctx.results = ctx.results ?? [];
          ctx.results.push({
            type: 'tool_result',
            toolCallId: call.toolCallId,
            toolName: 'qq_send',
            success: true,
            data: { message: '消息已加入发送队列' },
            durationMs: Date.now() - startTime,
          } as any);
        }

        // 处理 qq_info 调用
        for (const call of qqInfoCalls) {
          const startTime = Date.now();
          const params = call.arguments as Record<string, unknown>;
          const infoType = params.type as string;
          const targetId = params.target_id as string;

          // 返回一个占位结果（实际信息由上层填充）
          ctx.results = ctx.results ?? [];
          ctx.results.push({
            type: 'tool_result',
            toolCallId: call.toolCallId,
            toolName: 'qq_info',
            success: true,
            data: { status: 'query_dispatched', type: infoType, target_id: targetId },
            durationMs: Date.now() - startTime,
          } as any);
        }

        // 处理 request_game_action 调用
        for (const call of gameActionCalls) {
          const startTime = Date.now();
          const params = call.arguments as Record<string, unknown>;
          const description = (params.description as string) ?? '';
          const priority = (params.priority as 'normal' | 'high') ?? 'normal';

          // 优先查找 QQ Agent，通过 QQ Agent 转发（携带 QQ 用户上下文）
          const qqAgent = this.findQQAgent(workspaceId);
          if (qqAgent && typeof (qqAgent as any).requestGameAction === 'function') {
            try {
              const result = await (qqAgent as any).requestGameAction(description, priority);
              ctx.results = ctx.results ?? [];
              ctx.results.push({
                type: 'tool_result',
                toolCallId: call.toolCallId,
                toolName: 'request_game_action',
                success: result.success,
                data: { summary: result.summary, details: result.details, duration_ms: result.durationMs },
                error: result.error,
                durationMs: Date.now() - startTime,
              } as any);
              continue;
            } catch (err) {
              // QQ Agent 转发失败，降级到直接执行
            }
          }

          // 无 QQ Agent 时，直接通过当前 Agent 执行游戏操作
          // V34: 检查当前 Agent 所属工作区是否在线
          const wm = getWorkspaceManager();
          const ws = wm.getWorkspace(workspaceId);
          if (!ws || !ws.isOnline) {
            ctx.results = ctx.results ?? [];
            ctx.results.push({
              type: 'tool_result',
              toolCallId: call.toolCallId,
              toolName: 'request_game_action',
              success: false,
              error: '无法连接到游戏',
              durationMs: Date.now() - startTime,
            } as any);
            continue;
          }

          try {
            const currentAgent = this.getSync(workspaceId, agentId);
            if (!currentAgent) {
              ctx.results = ctx.results ?? [];
              ctx.results.push({
                type: 'tool_result',
                toolCallId: call.toolCallId,
                toolName: 'request_game_action',
                success: false,
                error: '当前 Agent 未就绪，无法执行游戏操作',
                durationMs: Date.now() - startTime,
              } as any);
              continue;
            }

            const result = await currentAgent.handle({
              source: 'trigger',
              prompt: `[请求] ${description}`,
              metadata: {
                origin: 'main_agent',
                priority,
                requestId: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
              },
            });

            ctx.results = ctx.results ?? [];
            ctx.results.push({
              type: 'tool_result',
              toolCallId: call.toolCallId,
              toolName: 'request_game_action',
              success: !result.error,
              data: result.error ? undefined : { summary: result.finalResponse, duration_ms: result.durationMs },
              error: result.error,
              durationMs: Date.now() - startTime,
            } as any);
          } catch (err) {
            ctx.results = ctx.results ?? [];
            ctx.results.push({
              type: 'tool_result',
              toolCallId: call.toolCallId,
              toolName: 'request_game_action',
              success: false,
              error: err instanceof Error ? err.message : '请求游戏操作异常',
              durationMs: Date.now() - startTime,
            } as any);
          }
        }

        // 从 pipeline 调度中移除所有已本地处理的调用
        ctx.calls = ctx.calls.filter((c) => c.toolName !== 'qq_send' && c.toolName !== 'qq_info' && c.toolName !== 'request_game_action');
        return ctx;
      },
    });

    // V31: 知识工具（Wiki / 搜索）本地处理器中间件
    // 避免在无 workspace 连接时通过 BatchToolDispatcher 分发到 ConnectionResolver
    pipeline.use({
      name: 'knowledge_tools_handler',
      before: async (ctx: MiddlewareContext): Promise<MiddlewareContext> => {
        const KNOWLEDGE_TOOLS = new Set([
          'web_search',
          'web_fetch',
          'minecraft_wiki_search',
          'minecraft_wiki_get_page',
          'minecraft_wiki_get_section',
        ]);
        const knowledgeCalls = ctx.calls.filter((c) => KNOWLEDGE_TOOLS.has(c.toolName));
        if (knowledgeCalls.length === 0) return ctx;

        for (const call of knowledgeCalls) {
          const startTime = Date.now();
          const params = call.arguments as Record<string, unknown>;

          try {
            let result: { success: boolean; data?: string; error?: string; duration?: number };

            switch (call.toolName) {
              case 'web_search': {
                const client = getSearchClient();
                if (!client) {
                  result = { success: false, error: '搜索客户端未初始化', duration: 0 };
                  break;
                }
                result = await webSearch(client, params as any);
                break;
              }
              case 'web_fetch': {
                const client = getSearchClient();
                if (!client) {
                  result = { success: false, error: '搜索客户端未初始化', duration: 0 };
                  break;
                }
                result = await webFetch(client, params as any);
                break;
              }
              case 'minecraft_wiki_search': {
                const client = getWikiClient();
                if (!client) {
                  result = { success: false, error: 'Wiki 客户端未初始化', duration: 0 };
                  break;
                }
                result = await wikiSearch(client, params as any);
                break;
              }
              case 'minecraft_wiki_get_page': {
                const client = getWikiClient();
                if (!client) {
                  result = { success: false, error: 'Wiki 客户端未初始化', duration: 0 };
                  break;
                }
                result = await wikiGetPage(client, params as any);
                break;
              }
              case 'minecraft_wiki_get_section': {
                const client = getWikiClient();
                if (!client) {
                  result = { success: false, error: 'Wiki 客户端未初始化', duration: 0 };
                  break;
                }
                result = await wikiGetSection(client, params as any);
                break;
              }
              default:
                result = { success: false, error: `未知知识工具: ${call.toolName}`, duration: 0 };
            }

            ctx.results = ctx.results ?? [];
            ctx.results.push({
              type: 'tool_result',
              toolCallId: call.toolCallId,
              toolName: call.toolName,
              success: result.success,
              data: result.success ? { content: result.data } : undefined,
              error: result.success ? undefined : result.error,
              durationMs: result.duration ?? Date.now() - startTime,
            } as any);
          } catch (err) {
            ctx.results = ctx.results ?? [];
            ctx.results.push({
              type: 'tool_result',
              toolCallId: call.toolCallId,
              toolName: call.toolName,
              success: false,
              error: err instanceof Error ? err.message : `${call.toolName} 执行异常`,
              durationMs: Date.now() - startTime,
            } as any);
          }
        }

        // 从 pipeline 调度中移除所有已本地处理的知识工具调用
        ctx.calls = ctx.calls.filter((c) => !KNOWLEDGE_TOOLS.has(c.toolName));
        return ctx;
      },
    });

    // 记忆工具本地处理器中间件
    pipeline.use({
      name: 'memory_tools_handler',
      before: async (ctx: MiddlewareContext): Promise<MiddlewareContext> => {
        const MEMORY_TOOL_NAMES = new Set([
          'memory_list', 'memory_query', 'memory_edit',
          'maps_query', 'maps_edit',
          'aim_list', 'aim_query', 'aim_update',
          'knowledge_query',
        ]);
        const memoryCalls = ctx.calls.filter((c) => MEMORY_TOOL_NAMES.has(c.toolName));
        if (memoryCalls.length === 0) return ctx;

        const mm = getMemoryManager();
        if (!mm) {
          for (const call of memoryCalls) {
            ctx.results = ctx.results ?? [];
            ctx.results.push({
              type: 'tool_result',
              toolCallId: call.toolCallId,
              toolName: call.toolName,
              success: false,
              error: '记忆系统未初始化',
              durationMs: 0,
            } as any);
          }
          ctx.calls = ctx.calls.filter((c) => !MEMORY_TOOL_NAMES.has(c.toolName));
          return ctx;
        }

        // 动态导入记忆工具处理函数（避免顶层 import 导致的循环依赖）
        const memoryTools = await import('../memory/tools');

        for (const call of memoryCalls) {
          const startTime = Date.now();
          const params = call.arguments as any;

          try {
            let result: { success: boolean; data?: unknown; error?: string };

            switch (call.toolName) {
              case 'memory_list':
                result = await memoryTools.memoryList(mm, params);
                break;
              case 'memory_query':
                result = await memoryTools.memoryQuery(mm, params);
                break;
              case 'memory_edit':
                result = await memoryTools.memoryEdit(mm, params);
                break;
              case 'maps_query':
                result = await memoryTools.mapsQuery(mm, params);
                break;
              case 'maps_edit':
                result = await memoryTools.mapsEdit(mm, params);
                break;
              case 'aim_list':
                result = await memoryTools.aimList(mm, params);
                break;
              case 'aim_query':
                result = await memoryTools.aimQuery(mm, params);
                break;
              case 'aim_update':
                result = await memoryTools.aimUpdate(mm, params);
                break;
              case 'knowledge_query':
                result = await memoryTools.knowledgeQuery(mm, params);
                break;
              default:
                result = { success: false, error: `未知记忆工具: ${call.toolName}` };
            }

            ctx.results = ctx.results ?? [];
            ctx.results.push({
              type: 'tool_result',
              toolCallId: call.toolCallId,
              toolName: call.toolName,
              success: result.success,
              data: result.success ? result.data : undefined,
              error: result.success ? undefined : result.error,
              durationMs: Date.now() - startTime,
            } as any);
          } catch (err) {
            ctx.results = ctx.results ?? [];
            ctx.results.push({
              type: 'tool_result',
              toolCallId: call.toolCallId,
              toolName: call.toolName,
              success: false,
              error: err instanceof Error ? err.message : `${call.toolName} 执行异常`,
              durationMs: Date.now() - startTime,
            } as any);
          }
        }

        ctx.calls = ctx.calls.filter((c) => !MEMORY_TOOL_NAMES.has(c.toolName));
        return ctx;
      },
    });

    // 任务工具本地处理器中间件
    pipeline.use({
      name: 'task_tools_handler',
      before: async (ctx: MiddlewareContext): Promise<MiddlewareContext> => {
        const TASK_TOOL_NAMES = new Set([
          'task_create', 'task_query', 'task_update',
          'task_control', 'task_decompose', 'task_manage',
        ]);
        const taskCalls = ctx.calls.filter((c) => TASK_TOOL_NAMES.has(c.toolName));
        if (taskCalls.length === 0) return ctx;

        const tm = getTaskManager();
        if (!tm) {
          for (const call of taskCalls) {
            ctx.results = ctx.results ?? [];
            ctx.results.push({
              type: 'tool_result',
              toolCallId: call.toolCallId,
              toolName: call.toolName,
              success: false,
              error: '任务系统未初始化',
              durationMs: 0,
            } as any);
          }
          ctx.calls = ctx.calls.filter((c) => TASK_TOOL_NAMES.has(c.toolName));
          return ctx;
        }

        // 动态导入任务工具处理函数
        const taskTools = await import('../task/tools');

        for (const call of taskCalls) {
          const startTime = Date.now();
          const params = call.arguments as any;

          try {
            let result: { success: boolean; data?: unknown; error?: string };

            switch (call.toolName) {
              case 'task_create':
                result = await taskTools.taskCreate(tm, params);
                break;
              case 'task_query':
                result = await taskTools.taskQuery(tm, params);
                break;
              case 'task_update':
                result = await taskTools.taskUpdate(tm, params);
                break;
              case 'task_control':
                result = await taskTools.taskControl(tm, params);
                break;
              case 'task_decompose':
                result = await taskTools.taskDecompose(tm, params);
                break;
              case 'task_manage':
                result = await taskTools.taskManage(tm, params);
                break;
              default:
                result = { success: false, error: `未知任务工具: ${call.toolName}` };
            }

            ctx.results = ctx.results ?? [];
            ctx.results.push({
              type: 'tool_result',
              toolCallId: call.toolCallId,
              toolName: call.toolName,
              success: result.success,
              data: result.success ? result.data : undefined,
              error: result.success ? undefined : result.error,
              durationMs: Date.now() - startTime,
            } as any);
          } catch (err) {
            ctx.results = ctx.results ?? [];
            ctx.results.push({
              type: 'tool_result',
              toolCallId: call.toolCallId,
              toolName: call.toolName,
              success: false,
              error: err instanceof Error ? err.message : `${call.toolName} 执行异常`,
              durationMs: Date.now() - startTime,
            } as any);
          }
        }

        ctx.calls = ctx.calls.filter((c) => !TASK_TOOL_NAMES.has(c.toolName));
        return ctx;
      },
    });

    // update_plan 工具本地处理器中间件
    pipeline.use({
      name: 'update_plan_handler',
      before: async (ctx: MiddlewareContext): Promise<MiddlewareContext> => {
        const planCalls = ctx.calls.filter((c) => c.toolName === 'update_plan');
        if (planCalls.length === 0) return ctx;

        // update_plan 由 Orchestrator 在 dispatch 后处理，
        // 这里不做具体执行，仅从 pipeline 调度中移除（避免发送到 adapter），
        // 让 Orchestrator 在 handle 返回后解析 update_plan tool_calls。
        // 回注空结果以便 LLM 继续后续轮次。
        for (const call of planCalls) {
          ctx.results = ctx.results ?? [];
          ctx.results.push({
            type: 'tool_result',
            toolCallId: call.toolCallId,
            toolName: 'update_plan',
            success: true,
            data: { message: 'update_plan 由 Orchestrator 处理' },
            durationMs: 0,
          } as any);
        }

        ctx.calls = ctx.calls.filter((c) => c.toolName !== 'update_plan');
        return ctx;
      },
    });

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
      streamEmitter: this.deps.streamEmitter,
    });
  }

  /**
   * V27: 在当前 workspace 下查找启用了 QQ 绑定的 Agent
   */
  private findQQAgent(workspaceId: string): MainAgent | undefined {
    for (const [key, agent] of this.cache.entries()) {
      const [ws] = key.split(':');
      if (ws === workspaceId && (agent as any).client) {
        // 检查是否有 QQ client（即此 agent 是 QQAgent）
        return agent;
      }
    }
    return undefined;
  }
}

/** 拼 cache key */
function makeKey(workspaceId: string, agentId: string): string {
  return `${workspaceId}:${agentId}`;
}
