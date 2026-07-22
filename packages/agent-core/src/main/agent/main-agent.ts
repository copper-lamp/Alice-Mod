/**
 * V20 §4.1 MainAgent — 主 Agent 主体
 *
 * 统一主/QQ 两套调用入口，编排完整链路：
 *   触发事件 → 选模型 → 构 prompt → 调度 LLM → 处理 tool_calls → 持久化历史
 *
 * 核心循环（handle 内部）：
 *   1. 根据 event.source 选 mainModel / qqBotModel
 *   2. 从 ChatHistoryStore 加载历史
 *   3. PromptBuilder.build() 组装 messages + tools
 *   4. 多轮循环（≤ maxRounds）：
 *      a. scheduler.schedule() 限流 + 排队
 *      b. modelRouter.resolve() → provider.chat()
 *      c. historyStore.append() 写 assistant
 *      d. finish_reason !== 'tool_calls' → break
 *      e. pipeline.process() → BatchToolDispatcher → JE tool_call_batch
 *      f. historyStore.append() 写 tool results
 *   5. 返回 MainAgentResult
 *
 * abort 透传：AbortSignal 从 MainAgent → Pipeline → BatchToolDispatcher
 *           → TcpConnection.sendRequestAndAwait，任一 await 检查到 abort 立刻抛 AbortError。
 */

import type { AgentConfig, AgentLLMConfig, ModelSelection } from '../../renderer/src/lib/types';
import type { ToolRegistry } from '../workspace/tool-registry';
import type { PromptBuilder } from '../prompt/builder/prompt-builder';
import type {
  IModelRouter,
  IProviderRegistry,
  ILLMObserver,
  LLMProvider,
  Message,
  LLMResponse as LlmLLMResponse,
  ToolDefinition,
  SchemaProperty,
  RouterContext,
  ResolvedModel,
} from '../llm/types';
import type { FunctionCallingPipeline } from '../pipeline/pipeline';
import type { ConnectionResolver } from './connection-resolver';
import type { ChatHistoryStore, ChatHistoryEntry } from '../chat-history/chat-history-store';
import type { LlmRequestScheduler, SchedulePriority } from '../llm/scheduler/types';
import type {
  LLMMessage,
  Conversation,
  LLMResponse as PipelineLLMResponse,
  PipelineResult,
  ToolCall as PipelineToolCall,
} from '../pipeline/types';
import type {
  ConversationMessage,
  PlayerState,
  BuildParams,
  BuildSource,
  ToolPromptDefinition,
} from '../prompt/types';
import { mapAgentConfigToProfile, getExcludeTools } from './agent-profile-mapper';
import { AbortError, NotConnectedError } from '../tcp/errors';

// ════════════════════════════════════════════════════════════════
// 公共类型
// ════════════════════════════════════════════════════════════════

export interface MainAgentDeps {
  /** Agent 配置（wizard 写入，未做映射的原始结构） */
  agentConfig: AgentConfig;
  workspaceId: string;
  agentId: string;
  toolRegistry: ToolRegistry;
  promptBuilder: PromptBuilder;
  modelRouter: IModelRouter;
  providerRegistry: IProviderRegistry;
  pipeline: FunctionCallingPipeline;
  /** 通过 workspaceId 找到 TcpConnection，发 tool_call_batch（见 §4.3/4.7） */
  connectionResolver: ConnectionResolver;
  historyStore: ChatHistoryStore;
  scheduler: LlmRequestScheduler;
  observer: ILLMObserver;
  /** 多轮迭代上限，默认 5 */
  maxRounds?: number;
  /** 外部 abort 信号（可选） */
  abortSignal?: AbortSignal;
  /**
   * 流式事件发射器（可选）
   * 每轮 LLM 响应后发射 thinking/text/tool_calls/done 事件，供前端实时显示。
   * agentId 用于标识事件来源，供前端按 agent 过滤。
   */
  streamEmitter?: (event: { type: 'thinking' | 'text' | 'tool_calls' | 'done'; data?: unknown; agentId?: string }) => void;
}

export interface MainAgentEvent {
  source: 'trigger' | 'qq' | 'debug' | 'system';
  prompt: string;
  metadata?: Record<string, unknown>;
}

export interface MainAgentResult {
  finalResponse: string;
  rounds: number;
  totalTokens: number;
  durationMs: number;
  error?: 'ABORTED' | 'WORLD_OFFLINE' | 'DISPATCHER_NOT_CONFIGURED' | 'PROVIDER_NOT_FOUND' | 'MAX_ROUNDS_EXCEEDED' | string;
  truncated?: boolean;
  /** V23：透传 metadata（用于 QQ Agent 获取 requestId、details 等） */
  metadata?: Record<string, unknown>;
}

// ════════════════════════════════════════════════════════════════
// SimpleConversation — pipeline Conversation 接口的轻量实现
// ════════════════════════════════════════════════════════════════

/**
 * 把 ConversationMessage[] 包装成 pipeline 期望的 Conversation 接口。
 * pipeline.injector.inject() 会调 addMessage() 注入 tool_result 消息。
 */
class SimpleConversation implements Conversation {
  messages: LLMMessage[];

  constructor(initial: ConversationMessage[]) {
    this.messages = initial.map(toLLMMessage);
  }

  addMessage(msg: LLMMessage): void {
    this.messages.push(msg);
  }

  getMessages(): LLMMessage[] {
    return this.messages;
  }
}

// ════════════════════════════════════════════════════════════════
// 类型转换辅助
// ════════════════════════════════════════════════════════════════

/** ConversationMessage → LLMMessage（pipeline 格式） */
function toLLMMessage(msg: ConversationMessage): LLMMessage {
  return {
    role: msg.role,
    content: msg.content,
    tool_calls: msg.tool_calls as PipelineToolCall[] | undefined,
    tool_call_id: msg.tool_call_id,
  };
}

/** LLMMessage → ConversationMessage（prompt 格式） */
function toConversationMessage(msg: LLMMessage): ConversationMessage {
  const content = typeof msg.content === 'string' ? msg.content : '';
  return {
    role: msg.role,
    content,
    tool_calls: msg.tool_calls as ConversationMessage['tool_calls'],
    tool_call_id: msg.tool_call_id,
  };
}

/** ConversationMessage → Message（llm Provider 格式） */
function toProviderMessage(msg: ConversationMessage): Message {
  const result: Record<string, unknown> = {
    role: msg.role,
    content: msg.content,
  };
  if (msg.tool_call_id) {
    result.tool_call_id = msg.tool_call_id;
  }
  // 必须包含 tool_calls 字段，否则 LLM Provider 无法将 tool_calls
  // 传递给 API，导致模型不理解工具调用上下文
  if (msg.tool_calls && msg.tool_calls.length > 0) {
    result.tool_calls = msg.tool_calls.map((tc) => {
      let args: Record<string, unknown> = {};
      if (typeof tc.function.arguments === 'string') {
        try { args = JSON.parse(tc.function.arguments); } catch { args = {}; }
      } else {
        args = tc.function.arguments as Record<string, unknown>;
      }
      return {
        type: 'tool_call' as const,
        toolCallId: tc.id,
        toolName: tc.function.name,
        arguments: args,
      };
    });
  }
  return result as unknown as Message;
}

/**
 * llm/types.ts LLMResponse → pipeline/types.ts LLMResponse
 * 把 camelCase finishReason + ToolCallContent 转为 snake_case + ToolCall
 */
function toPipelineLLMResponse(resp: LlmLLMResponse): PipelineLLMResponse {
  const toolCalls = resp.message.tool_calls?.map((tc): PipelineToolCall => ({
    id: tc.toolCallId,
    type: 'function',
    function: {
      name: tc.toolName,
      arguments: JSON.stringify(tc.arguments),
    },
  }));

  return {
    message: {
      role: 'assistant',
      content: typeof resp.message.content === 'string'
        ? resp.message.content
        : null,
      tool_calls: toolCalls,
    },
    finish_reason: resp.finishReason,
    usage: resp.usage ? {
      prompt_tokens: resp.usage.promptTokens,
      completion_tokens: resp.usage.completionTokens,
      total_tokens: resp.usage.totalTokens,
    } : undefined,
  };
}

/** ToolPromptDefinition[] → ToolDefinition[]（llm Provider 格式） */
function toToolDefinitions(tools: ToolPromptDefinition[]): ToolDefinition[] {
  return tools.map((t): ToolDefinition => {
    const properties: Record<string, SchemaProperty> = {};
    const required: string[] = [];
    for (const [name, param] of Object.entries(t.parameters)) {
      properties[name] = {
        type: param.type as SchemaProperty['type'],
        description: param.description,
        enum: param.enum,
        default: param.default,
      };
      if (param.required) required.push(name);
    }
    return {
      name: t.name,
      description: t.description,
      input_schema: {
        type: 'object' as const,
        properties,
        required: required.length > 0 ? required : undefined,
      },
    };
  });
}

/** 提取 LLM 消息内容的字符串形式 */
function extractContent(content: LlmLLMResponse['message']['content']): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => (c.type === 'text' ? c.text : ''))
      .join('');
  }
  return '';
}

/**
 * V30: 增强的 thinking 过滤函数
 *
 * 覆盖所有常见 LLM 思考格式：
 * - <thinking>...</thinking>（XML 标签）
 * - thinking...</thinking>（纯文本标记）
 * - [thinking]...[/thinking]（BBcode 风格）
 * - 【思考】...（中文格式）
 * - {thinking}...{/thinking}（JSON 风格）
 * - 独立的 "thinking" / "response" 前缀
 * - 大小写不敏感匹配
 */
function filterThinkingContent(content: string): string {
  // 1. 先清理所有带标签的 thinking 块（跨行）
  let result = content
    // XML 标签格式 <thinking>...</thinking>
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
    // 纯文本格式 thinking...</thinking>
    .replace(/^thinking[\s\S]*?^<\/thinking>/gim, '')
    // BBcode 风格 [thinking]...[/thinking]
    .replace(/\[thinking\][\s\S]*?\[\/thinking\]/gi, '')
    // 中文格式 【思考】...
    .replace(/【思考】[\s\S]*?(?:\n|$)/g, '')
    // JSON 风格 {thinking}...{/thinking}
    .replace(/\{thinking\}[\s\S]*?\{\/thinking\}/gi, '')
    // 注释风格 <!-- thinking ... -->
    .replace(/<!--\s*thinking[\s\S]*?-->/gi, '');

  // 2. 清理独立的 "thinking" / "response" 前缀行（大小写不敏感）
  result = result
    .replace(/^\s*thinking\s*$/gim, '')
    .replace(/^\s*response\s*$/gim, '')
    .replace(/^\s*\[thinking\]\s*$/gim, '')
    .replace(/^\s*\[\/thinking\]\s*$/gim, '');

  // 3. 清理多余的空白行
  result = result
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return result;
}

/**
 * V33: 从原始 LLM 响应中提取 thinking 内容
 * 使用与 filterThinkingContent 相同的正则模式反向提取
 */
function extractThinking(content: string): string | null {
  const match = content.match(/<thinking>([\s\S]*?)<\/thinking>/i)
    ?? content.match(/\[thinking\]([\s\S]*?)\[\/thinking\]/i)
    ?? content.match(/\{thinking\}([\s\S]*?)\{\/thinking\}/i)
    ?? content.match(/<!--\s*thinking\s*([\s\S]*?)-->/i);
  return match?.[1]?.trim() ?? null;
}

/** 把 BuildSource 映射到 MainAgentEvent.source */
function toBuildSource(source: MainAgentEvent['source']): BuildSource {
  switch (source) {
    case 'trigger': return 'event';
    case 'system': return 'system';
    case 'qq': return 'user';
    case 'debug': return 'user';
    default: return 'event';
  }
}

/**
 * 清理对话历史中损坏的 tool_calls 条目
 *
 * 当之前的 session 因 pipeline 故障导致 tool 结果未注入时，
 * 数据库中会留下 assistant 消息有 tool_calls 但无对应 tool 消息的损坏记录。
 * 这会导致 OpenAI API 报错：
 *   "An assistant message with 'tool_calls' must be followed by tool messages..."
 * 或反向：
 *   "Messages with role 'tool' must be a response to a preceding message with 'tool_calls'"
 *
 * 修复策略：顺序扫描，维护期望的 tool_call_id 集合，清理不匹配的条目。
 * 同时返回需要从数据库中删除的条目 ID，避免每次加载历史时重复清理。
 *
 * @param messages 待清理的消息数组
 * @param entryIds 可选，消息数组对应的数据库条目 ID（用于删除数据库中的损坏记录）
 * @returns { messages: 清理后的消息数组, removedIds: 需要从数据库删除的条目 ID }
 */
function sanitizeHistory(
  messages: ConversationMessage[],
  entryIds?: number[],
): { messages: ConversationMessage[]; removedIds: number[] } {
  const result: ConversationMessage[] = [];
  const removedIds: number[] = [];
  // 记录 result 中每个元素对应的原始 messages 索引
  const resultToOriginalIdx: number[] = [];
  let expectedToolCallIds = new Set<string>();
  // 记录最近一条有 tool_calls 的 assistant 消息在 result 中的索引
  let lastAssistantResultIdx = -1;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    if (msg.role === 'tool' && msg.tool_call_id) {
      if (expectedToolCallIds.has(msg.tool_call_id)) {
        result.push(msg);
        resultToOriginalIdx.push(i);
        expectedToolCallIds.delete(msg.tool_call_id);
      } else {
        console.warn(`[MainAgent] 清理孤立的 tool 消息: tool_call_id=${msg.tool_call_id}`);
        // 孤立 tool 消息需要从数据库删除
        if (entryIds && entryIds[i] !== undefined) {
          removedIds.push(entryIds[i]);
        }
      }
      continue;
    }

    if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
      // 前一轮未完成的 tool_calls 被新 assistant 覆盖
      if (expectedToolCallIds.size > 0) {
        console.warn(`[MainAgent] 清理未完成的 tool_calls (被新 assistant 覆盖): ${Array.from(expectedToolCallIds).join(', ')}`);
        // 记录被清理的 assistant 条目（需要从数据库删除其 tool_calls 记录）
        if (entryIds && lastAssistantResultIdx >= 0) {
          const origIdx = resultToOriginalIdx[lastAssistantResultIdx];
          if (entryIds[origIdx] !== undefined) {
            removedIds.push(entryIds[origIdx]);
          }
        }
        // 移除前一条 assistant 的 tool_calls
        result[lastAssistantResultIdx] = { role: 'assistant', content: result[lastAssistantResultIdx]?.content ?? '' };
      }
      expectedToolCallIds = new Set(msg.tool_calls.map(tc => tc.id));
      lastAssistantResultIdx = result.length;
      result.push(msg);
      resultToOriginalIdx.push(i);
      continue;
    }

    // 非 tool、非 assistant-with-tool_calls 的消息
    if (expectedToolCallIds.size > 0) {
      console.warn(`[MainAgent] 清理未完成的 tool_calls (遇到非 tool 消息): ${Array.from(expectedToolCallIds).join(', ')}`);
      // 记录被清理的 assistant 条目（需要从数据库删除其 tool_calls 记录）
      if (entryIds && lastAssistantResultIdx >= 0) {
        const origIdx = resultToOriginalIdx[lastAssistantResultIdx];
        if (entryIds[origIdx] !== undefined) {
          removedIds.push(entryIds[origIdx]);
        }
      }
      // 移除前一条 assistant 的 tool_calls
      result[lastAssistantResultIdx] = { role: 'assistant', content: result[lastAssistantResultIdx]?.content ?? '' };
      expectedToolCallIds.clear();
      lastAssistantResultIdx = -1;
    }
    result.push(msg);
    resultToOriginalIdx.push(i);
  }

  // 处理消息数组末尾未完成的 tool_calls
  if (expectedToolCallIds.size > 0 && lastAssistantResultIdx >= 0) {
    console.warn(`[MainAgent] 清理末尾未完成的 tool_calls: ${Array.from(expectedToolCallIds).join(', ')}`);
    // 记录末尾未完成的 assistant 条目（需要从数据库清理）
    if (entryIds && lastAssistantResultIdx >= 0) {
      const origIdx = resultToOriginalIdx[lastAssistantResultIdx];
      if (entryIds[origIdx] !== undefined) {
        removedIds.push(entryIds[origIdx]);
      }
    }
    result[lastAssistantResultIdx] = { role: 'assistant', content: result[lastAssistantResultIdx]?.content ?? '' };
  }

  return { messages: result, removedIds };
}

/**
 * V31: 在 LLM 调用前验证并修复消息列表中的 tool_calls/tool 配对
 *
 * 即使 sanitizeHistory 已清理历史，当前 session 的多轮循环中
 * pipeline 可能仍存在注入问题，导致 messages 中存在损坏的配对。
 * 此函数在每次 LLM 调用前执行，确保 API 不会因配对问题报错。
 */
function validateMessagesForLLM(messages: ConversationMessage[]): ConversationMessage[] {
  // 使用相同的 sanitizeHistory 逻辑，但针对当前 session 的 messages
  // 这可以捕获 pipeline 处理后的残留问题
  // 当前 session 的消息没有数据库 ID，不需要持久化清理
  return sanitizeHistory(messages).messages;
}

/** 根据 event.source 决定调度优先级 */
function getPriority(source: MainAgentEvent['source']): SchedulePriority {
  switch (source) {
    case 'trigger': return 'high';
    case 'qq': return 'normal';
    case 'system': return 'high';
    case 'debug': return 'low';
    default: return 'normal';
  }
}

/**
 * V34: 获取用于存储/加载历史的 agentId
 * QQ 来源使用 qq:${agentId} 作为复合键，与主 Agent 存储完全分离
 */
function getStorageAgentId(agentId: string, source: MainAgentEvent['source']): string {
  return source === 'qq' ? `qq:${agentId}` : agentId;
}

// ════════════════════════════════════════════════════════════════
// MainAgent 主体
// ════════════════════════════════════════════════════════════════

export class MainAgent {
  protected readonly deps: MainAgentDeps;
  private abortController: AbortController | null = null;

  constructor(deps: MainAgentDeps) {
    this.deps = deps;
  }

  /**
   * 主入口：单次多轮（循环到 finish_reason=stop 或达 maxRounds）
   *
   * @throws AbortError 当外部 abort 或内部 abort() 被调用
   */
  async handle(event: MainAgentEvent): Promise<MainAgentResult> {
    const startTime = Date.now();
    this.abortController = new AbortController();

    // 合并外部 abort 信号
    if (this.deps.abortSignal) {
      if (this.deps.abortSignal.aborted) {
        return this.fail(startTime, 0, 0, 'ABORTED');
      }
      this.deps.abortSignal.addEventListener('abort', () => this.abortController?.abort(), { once: true });
    }

    const signal = this.abortController.signal;
    const maxRounds = this.deps.maxRounds ?? 5;

    try {
      // ── 0. 日志 ──
      console.log(`[MainAgent] handle() 开始 (agent=${this.deps.agentId}, source=${event.source}, prompt=${event.prompt?.slice(0, 80)}${event.prompt?.length > 80 ? '...' : ''})`);

      // ── 1. 选模型 ──
      const modelKey: keyof AgentLLMConfig = (event.source === 'qq' || event.source === 'debug')
        ? 'qqBotModel'
        : 'mainModel';
      let modelSel = this.deps.agentConfig.llmConfig[modelKey];
      // V31 FIX: 如果 sameAsMain 为 true，回退到 mainModel
      if (modelSel?.sameAsMain && modelKey === 'qqBotModel') {
        modelSel = this.deps.agentConfig.llmConfig.mainModel;
      }
      // V20 FIX: 如果 qqBotModel 未配置（providerId 为空字符串），回退到 mainModel
      if (!modelSel?.providerId && modelKey === 'qqBotModel') {
        modelSel = this.deps.agentConfig.llmConfig.mainModel;
      }
      console.log(`[MainAgent] 模型选择: key=${modelKey}, provider=${modelSel?.providerId}, model=${modelSel?.modelName}`);

      // ── 2. 加载历史 ──
      // V28 FIX: QQ 来源时加载更多历史记录（支持更长的对话上下文）
      const historyLimit = event.source === 'qq' ? maxRounds * 8 : maxRounds * 2;
      // V34 FIX: QQ 来源使用 qq:${agentId} 复合键存储，与主 Agent 完全分离
      const storageAgentId = getStorageAgentId(this.deps.agentId, event.source);
      const historyEntries = await this.deps.historyStore.load(
        this.deps.workspaceId,
        storageAgentId,
        { limit: historyLimit },
      );
      const history: ConversationMessage[] = historyEntries.map((e) => ({
        role: e.role,
        content: e.content,
        tool_calls: e.toolCalls,
        tool_call_id: e.toolCallId,
      }));
      // 提取数据库条目 ID（用于后续清理数据库中损坏的记录）
      const historyEntryIds = historyEntries.map((e) => e.id!);

      // V31 FIX: 清理历史中损坏的 tool_calls（防止之前 session 遗留的损坏数据导致 API 报错）
      // V32 FIX: 同时从数据库中删除损坏的记录，避免每次加载时重复清理
      const { messages: sanitizedHistory, removedIds } = sanitizeHistory(history, historyEntryIds);
      if (removedIds.length > 0) {
        this.deps.historyStore.deleteByIds(removedIds).catch((err) =>
          console.warn(`[MainAgent] 清理数据库中损坏的条目失败:`, err),
        );
      }

      // ── 3. 构建 prompt ──
      const excludeTools = getExcludeTools(this.deps.agentConfig);
      const profile = mapAgentConfigToProfile(this.deps.agentConfig);
      this.deps.promptBuilder.updateProfile(profile);

      // V26: 兼容旧数据 — 惰性编译并回填
      if (!this.deps.agentConfig.compiledPrompt) {
        try {
          const { PromptCompiler } = await import('../prompt/compiler/prompt-compiler');
          const compiled = PromptCompiler.compile(this.deps.agentConfig);
          this.deps.agentConfig.compiledPrompt = compiled;
          // 异步回填到数据库（不阻塞推理）
          const { getSharedAgentConfigManager } = await import('../ipc/agent-handler');
          getSharedAgentConfigManager().updateCompiledPrompt(this.deps.agentId, compiled).catch(err =>
            console.warn(`[MainAgent] 惰性编译回填失败 ${this.deps.agentId}:`, err),
          );
        } catch {
          // 回退到动态组装
        }
      }

      // V28: 兼容旧数据 — 惰性编译 QQ 提示词并回填
      if (event.source === 'qq' && !this.deps.agentConfig.qqCompiledPrompt) {
        try {
          const { PromptCompiler } = await import('../prompt/compiler/prompt-compiler');
          const qqCompiled = PromptCompiler.compileQQ(this.deps.agentConfig);
          this.deps.agentConfig.qqCompiledPrompt = qqCompiled;
          // 异步回填到数据库（不阻塞推理）
          const { getSharedAgentConfigManager } = await import('../ipc/agent-handler');
          getSharedAgentConfigManager().updateCompiledPrompt(this.deps.agentId, undefined, qqCompiled).catch(err =>
            console.warn(`[MainAgent] QQ 提示词惰性编译回填失败 ${this.deps.agentId}:`, err),
          );
        } catch {
          // 回退到动态组装
        }
      }

      // V28 FIX: QQ 来源时使用 qqCompiledPrompt（与主 Agent 完全独立的提示词）
      const effectiveSystemPrompt = (event.source === 'qq' && this.deps.agentConfig.qqCompiledPrompt)
        ? this.deps.agentConfig.qqCompiledPrompt
        : (this.deps.agentConfig.compiledPrompt ?? undefined);

      const buildParams: BuildParams = {
        workspaceId: this.deps.workspaceId,
        userInput: event.prompt,
        history: sanitizedHistory,
        // V30: QQ 来源不注入游戏状态（聊天 Agent 不需要玩家状态信息）
        state: event.source === 'qq' ? { skip: true, health: 0, hunger: 0, saturation: 0, position: { x: 0, y: 0, z: 0, dimension: '' }, statusEffects: [] } : this.getPlaceholderPlayerState(),
        source: toBuildSource(event.source),
        // V26: 优先使用预编译提示词，避免运行时动态组装
        // V28 FIX: QQ 来源时自动使用 qqCompiledPrompt
        systemOverride: effectiveSystemPrompt,
        extraContext: {
          excludeTools,
          // V22：透传 Orchestrator 注入的进展状态与技能文本
          progress: event.metadata?.progress,
          skills: event.metadata?.skills,
        },
        // V23：从 metadata 中透传 peerContext（QQ Agent 在 handleQQMessage 中注入）
        peerContext: event.metadata?.peerContext as BuildParams['peerContext'] | undefined,
      };

      const promptResult = await this.deps.promptBuilder.build(buildParams);
      let messages: ConversationMessage[] = [...promptResult.messages];
      // V32: QQ 来源时过滤掉 task/aim/maps 类别的工具（聊天 Agent 不需要管理工具）
      // V34: 非 QQ 来源时过滤掉 qq 类别工具（主 Agent 不需要 request_game_action 等 QQ 专属工具）
      const excludedCategories = new Set(['task', 'aim', 'maps']);
      const filteredTools = event.source === 'qq'
        ? promptResult.tools.filter(t => !excludedCategories.has(t.category))
        : promptResult.tools.filter(t => t.category !== 'qq');
      const tools = toToolDefinitions(filteredTools);

      // ── 4. 多轮循环 ──
      let totalTokens = 0;
      let lastResponse: LlmLLMResponse | null = null;
      let rounds = 0;
      let pipelineError: string | undefined;

      for (rounds = 0; rounds < maxRounds; rounds++) {
        if (signal.aborted) return this.fail(startTime, rounds, totalTokens, 'ABORTED');

        // a. 调度 + 解析模型
        const resolved = await this.deps.scheduler.schedule(
          {
            providerId: modelSel.providerId,
            priority: getPriority(event.source),
          },
          async () => {
            const ctx: RouterContext = {
              workspaceId: this.deps.workspaceId,
              requiresTools: tools.length > 0,
              requiresStreaming: false,
              providerId: modelSel?.providerId,
              model: modelSel?.modelName,
            };
            const routerResult = await this.deps.modelRouter.resolve(ctx);
            // V31 FIX: 确保使用用户配置的模型名，而不是路由器可能返回的默认模型
            // 路由器可能因为 provider 未找到、降级等 fallback 到其他模型
            if (modelSel?.modelName) {
              routerResult.model = modelSel.modelName;
            }
            return routerResult;
          },
        );

        // b. 获取 Provider
        const provider = this.deps.providerRegistry.get(resolved.providerId);
        if (!provider) {
          return this.fail(startTime, rounds, totalTokens, `PROVIDER_NOT_FOUND: ${resolved.providerId}`);
        }

        // c. V31 FIX: 在 LLM 调用前验证 messages 中的 tool_calls/tool 配对
        // 防止当前 session 中 pipeline 注入问题导致的损坏数据
        messages = validateMessagesForLLM(messages);

        const llmMessages = messages.map(toProviderMessage);
        // V28: QQ 来源时输出完整上下文日志（调试用）
        if (event.source === 'qq' && rounds === 0) {
          console.log(`[MainAgent] QQ 完整上下文 (${this.deps.agentId}):\n${llmMessages.map(m => `[${m.role}]\n${m.content}`).join('\n---\n')}`);
        }
        // V32 FIX: 移除重复的 observer.wrap，base-provider.ts 的 chat() 方法内部已调用 observer.wrap
        // 避免每次 API 调用被记录两次导致统计翻倍
        const response = await provider.chat(
          llmMessages,
          tools.length > 0 ? tools : undefined,
          resolved.options,
        );
        totalTokens += response.usage.totalTokens;
        lastResponse = response;
        console.log(`[MainAgent] LLM 响应 (round=${rounds + 1}/${maxRounds}): provider=${resolved.providerId}, model=${resolved.model}, tokens=${response.usage.totalTokens}, finish=${response.finishReason}, content=${extractContent(response.message.content)?.slice(0, 60) ?? ''}`);

        // V33: 发射流式事件（前端实时显示）
        if (this.deps.streamEmitter) {
          const rawContent = extractContent(response.message.content) ?? '';
          // V35: 优先使用 API 返回的 thinking（如 DeepSeek 的 reasoning_content），
          // 其次尝试从文本内容中解析 <thinking> 标签
          const thinking = response.thinking || extractThinking(rawContent) || undefined;
          const cleanContent = filterThinkingContent(rawContent);
          if (thinking) {
            this.deps.streamEmitter({ type: 'thinking', data: thinking, agentId: this.deps.agentId });
          }
          if (cleanContent) {
            this.deps.streamEmitter({ type: 'text', data: cleanContent, agentId: this.deps.agentId });
          }
          if (response.message.tool_calls?.length) {
            this.deps.streamEmitter({ type: 'tool_calls', data: response.message.tool_calls.map(tc => ({
              id: tc.toolCallId,
              name: tc.toolName,
              arguments: tc.arguments,
            })), agentId: this.deps.agentId });
          }
        }

        // d. 持久化 assistant 消息（V30: 增强的 thinking 过滤，覆盖所有常见格式）
        const assistantContent = filterThinkingContent(extractContent(response.message.content));
        // V34: 使用复合键分离 QQ 来源存储
        const storageAgentIdForSave = getStorageAgentId(this.deps.agentId, event.source);
        await this.deps.historyStore.append({
          workspaceId: this.deps.workspaceId,
          agentId: storageAgentIdForSave,
          source: event.source,
          eventId: event.metadata?.eventId as string | undefined,
          role: 'assistant',
          content: assistantContent,
          toolCalls: response.message.tool_calls?.map((tc) => ({
            id: tc.toolCallId,
            type: 'function' as const,
            function: { name: tc.toolName, arguments: JSON.stringify(tc.arguments) },
          })),
          finishReason: response.finishReason,
          tokenCount: response.usage.totalTokens,
          createdAt: Date.now(),
        });

        // 把 assistant 消息加到 messages（含 tool_calls）
        messages.push({
          role: 'assistant',
          content: assistantContent,
          tool_calls: response.message.tool_calls?.map((tc) => ({
            id: tc.toolCallId,
            type: 'function' as const,
            function: { name: tc.toolName, arguments: JSON.stringify(tc.arguments) },
          })),
        });

        // e. 检查是否结束
        if (response.finishReason !== 'tool_calls') {
          break;
        }

        // f. 通过 pipeline 执行 tool_calls
        if (signal.aborted) return this.fail(startTime, rounds, totalTokens, 'ABORTED');
        const toolNames = response.message.tool_calls?.map(tc => tc.toolName).join(', ') ?? '';
        console.log(`[MainAgent] 工具调用 (round=${rounds + 1}): ${toolNames}`);

        const pipelineResponse = toPipelineLLMResponse(response);
        const conversation = new SimpleConversation(messages);

        try {
          const pipelineResult = await this.deps.pipeline.process(
            pipelineResponse,
            this.deps.workspaceId,
            conversation,
            undefined,
            signal,
          );

          // g. 从 conversation 同步 messages（pipeline 已注入 tool_result）
          messages = conversation.getMessages().map(toConversationMessage);

          // h. 持久化 tool 结果（包含完整结果信息，供前端展示）
          for (const toolResult of pipelineResult.toolResults) {
            const payload: Record<string, unknown> = {
              success: toolResult.success,
            };
            if (toolResult.data) payload.data = toolResult.data;
            if (toolResult.error) payload.error = toolResult.error;
            if (toolResult.durationMs >= 0) payload.duration_ms = toolResult.durationMs;

            // V34: 使用复合键分离 QQ 来源存储
            const toolStorageAgentId = getStorageAgentId(this.deps.agentId, event.source);
            await this.deps.historyStore.append({
              workspaceId: this.deps.workspaceId,
              agentId: toolStorageAgentId,
              source: event.source,
              eventId: event.metadata?.eventId as string | undefined,
              role: 'tool',
              content: JSON.stringify(payload),
              toolCallId: toolResult.toolCallId,
              createdAt: Date.now(),
            });
          }
        } catch (err) {
          if (err instanceof NotConnectedError) {
            return this.fail(startTime, rounds, totalTokens, 'WORLD_OFFLINE');
          }
          if (err instanceof AbortError) {
            return this.fail(startTime, rounds, totalTokens, 'ABORTED');
          }
          // 其他 pipeline 错误：记录但继续下一轮（让 LLM 决定如何处理）
          pipelineError = err instanceof Error ? err.message : String(err);
          // 注入一条 tool_result 标记失败，让 LLM 知道工具执行出错
          if (response.message.tool_calls) {
            for (const tc of response.message.tool_calls) {
              messages.push({
                role: 'tool',
                content: `工具执行失败: ${pipelineError}`,
                tool_call_id: tc.toolCallId,
              });
            }
          }
        }
      }

      // ── 5. 返回结果 ──
      // V30: 增强的 thinking 过滤（覆盖所有常见格式）
      const rawContent = lastResponse ? extractContent(lastResponse.message.content) : '';
      const finalResponse = filterThinkingContent(rawContent);
      const truncated = rounds >= maxRounds && lastResponse?.finishReason === 'tool_calls';
      const durationMs = Date.now() - startTime;
      console.log(`[MainAgent] handle() 完成 (agent=${this.deps.agentId}, source=${event.source}): rounds=${rounds}, totalTokens=${totalTokens}, durationMs=${durationMs}, truncated=${truncated}, error=${truncated ? 'MAX_ROUNDS_EXCEEDED' : pipelineError ?? 'none'}, finalResponse=${finalResponse.slice(0, 60)}${finalResponse.length > 60 ? '...' : ''}`);

      // V33: 发射 done 事件
      if (this.deps.streamEmitter) {
        this.deps.streamEmitter({ type: 'done', data: { finalResponse, rounds, totalTokens, durationMs, truncated }, agentId: this.deps.agentId });
      }

      return {
        finalResponse,
        rounds,
        totalTokens,
        durationMs,
        truncated,
        error: truncated ? 'MAX_ROUNDS_EXCEEDED' : pipelineError,
        // V23：透传 event.metadata（不含 peerContext 避免膨胀）
        metadata: event.metadata ? { ...event.metadata, peerContext: undefined } : undefined,
      };

    } catch (err) {
      if (err instanceof AbortError) {
        return this.fail(startTime, 0, 0, 'ABORTED');
      }
      // 未预期错误：向上抛
      throw err;
    } finally {
      this.abortController = null;
    }
  }

  /**
   * 流式入口（给 QQ Sub-Agent 用，逐 chunk yield）
   *
   * V20 P0 阶段为简化实现，内部仍走 handle() 的非流式路径，
   * 把最终结果作为单个 chunk yield。P1 阶段可改为真正的流式。
   */
  async *stream(event: MainAgentEvent): AsyncIterable<{ type: 'text' | 'tool_call' | 'done'; content?: string }> {
    const result = await this.handle(event);
    if (result.error) {
      yield { type: 'text', content: `[错误: ${result.error}]` };
    }
    if (result.finalResponse) {
      yield { type: 'text', content: result.finalResponse };
    }
    yield { type: 'done' };
  }

  /** 中止当前 handle/stream 调用 */
  abort(): void {
    this.abortController?.abort();
  }

  /** V22：获取 workspaceId（供 Orchestrator 工厂使用） */
  getWorkspaceId(): string {
    return this.deps.workspaceId;
  }

  /** V22：获取 agentId（供 Orchestrator 工厂使用） */
  getAgentId(): string {
    return this.deps.agentId;
  }

  // ════════════════════════════════════════════════════════════
  // 内部辅助
  // ════════════════════════════════════════════════════════════

  private fail(startTime: number, rounds: number, totalTokens: number, error: string): MainAgentResult {
    // V33: 发射 done 事件（错误终止）
    if (this.deps.streamEmitter) {
      this.deps.streamEmitter({ type: 'done', data: { error }, agentId: this.deps.agentId });
    }
    return {
      finalResponse: '',
      rounds,
      totalTokens,
      durationMs: Date.now() - startTime,
      error,
    };
  }

  /**
   * 占位 PlayerState（V20 P0 不接入 L2 感知，用默认值）
   *
   * P1 阶段改为从 L2 环境快照模块获取真实状态。
   */
  private getPlaceholderPlayerState(): PlayerState {
    return {
      health: 20,
      hunger: 20,
      saturation: 5,
      position: { x: 0, y: 64, z: 0, dimension: 'overworld' },
      statusEffects: [],
    };
  }
}
