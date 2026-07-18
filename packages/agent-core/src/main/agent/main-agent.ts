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
  return {
    role: msg.role,
    content: msg.content,
  };
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
      // ── 1. 选模型 ──
      const modelKey: keyof AgentLLMConfig = (event.source === 'qq' || event.source === 'debug')
        ? 'qqBotModel'
        : 'mainModel';
      let modelSel = this.deps.agentConfig.llmConfig[modelKey];
      // V20 FIX: 如果 qqBotModel 未配置（providerId 为空字符串），回退到 mainModel
      if (!modelSel?.providerId && modelKey === 'qqBotModel') {
        modelSel = this.deps.agentConfig.llmConfig.mainModel;
      }

      // ── 2. 加载历史 ──
      const historyEntries = await this.deps.historyStore.load(
        this.deps.workspaceId,
        this.deps.agentId,
        { limit: maxRounds * 2 },
      );
      const history: ConversationMessage[] = historyEntries.map((e) => ({
        role: e.role,
        content: e.content,
        tool_calls: e.toolCalls,
        tool_call_id: e.toolCallId,
      }));

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

      const buildParams: BuildParams = {
        workspaceId: this.deps.workspaceId,
        userInput: event.prompt,
        history,
        state: this.getPlaceholderPlayerState(),
        source: toBuildSource(event.source),
        // V26: 优先使用预编译提示词，避免运行时动态组装
        systemOverride: this.deps.agentConfig.compiledPrompt ?? undefined,
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
      const tools = toToolDefinitions(promptResult.tools);

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
            return this.deps.modelRouter.resolve(ctx);
          },
        );

        // b. 获取 Provider
        const provider = this.deps.providerRegistry.get(resolved.providerId);
        if (!provider) {
          return this.fail(startTime, rounds, totalTokens, `PROVIDER_NOT_FOUND: ${resolved.providerId}`);
        }

        // c. 调用 LLM（通过 observer 包装）
        const llmMessages = messages.map(toProviderMessage);
        const response = await this.deps.observer.wrap(
          resolved.providerId,
          resolved.model,
          () => provider.chat(
            llmMessages,
            tools.length > 0 ? tools : undefined,
            resolved.options,
          ),
        );
        totalTokens += response.usage.totalTokens;
        lastResponse = response;

        // d. 持久化 assistant 消息
        const assistantContent = extractContent(response.message.content);
        await this.deps.historyStore.append({
          workspaceId: this.deps.workspaceId,
          agentId: this.deps.agentId,
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

          // h. 持久化 tool 结果
          for (const toolResult of pipelineResult.toolResults) {
            await this.deps.historyStore.append({
              workspaceId: this.deps.workspaceId,
              agentId: this.deps.agentId,
              source: event.source,
              eventId: event.metadata?.eventId as string | undefined,
              role: 'tool',
              content: toolResult.error ?? JSON.stringify(toolResult.data ?? {}),
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
      const finalResponse = lastResponse ? extractContent(lastResponse.message.content) : '';
      const truncated = rounds >= maxRounds && lastResponse?.finishReason === 'tool_calls';

      return {
        finalResponse,
        rounds,
        totalTokens,
        durationMs: Date.now() - startTime,
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
