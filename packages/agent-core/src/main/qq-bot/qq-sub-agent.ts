/**
 * QQSubAgent — QQ 子 Agent
 *
 * 独立的 LLM 会话实例，专门处理 QQ 消息。
 * 拥有独立的 AgentProfile、对话上下文和工具集。
 * 通过内部消息队列与主 Agent（游戏 Agent）通信。
 *
 * 工作流程：
 * 1. 接收 QQ 消息 → 注入 Sub-Agent 对话上下文
 * 2. LLM 调用 → 意图判断
 * 3. 根据意图路由：
 *    - 纯 QQ 操作 → 调用 qq_info / qq_send 工具 → 回复
 *    - 需要游戏操作 → request_game_action → 主 Agent 处理 → 回复
 *    - 纯聊天 → LLM 直接生成回复
 *    - 桥接消息 → 转发到 MessageBridge
 */

import type { IModelRouter, LLMProvider, Message, LLMResponse, ToolDefinition, RouterContext } from '../llm/types';
import type { AgentProfile, ConversationMessage } from '../prompt/types';
import type {
  QQMessage,
  QQReply,
  QQSubAgentConfig,
  QQSubAgentEvent,
  QQSubAgentEventHandler,
  SubAgentStatus,
  GameActionRequest,
  GameActionResult,
} from './types';
import { DEFAULT_SUB_AGENT_CONFIG } from './types';
import { mainAgentTaskQueue } from './main-agent-queue';

// ════════════════════════════════════════════════════════════════
// 1. QQ Sub-Agent Profile 定义
// ════════════════════════════════════════════════════════════════

/** QQ Sub-Agent 的默认身份模板 */
const QQ_SUB_AGENT_PROFILE: AgentProfile = {
  name: 'QQ 机器人助手',
  identity: `你是 McAgent 的 QQ 机器人助手，负责处理 QQ 群聊和私聊中的消息。

你的职责：
1. 回复 QQ 用户的问题，提供友好的对话体验
2. 当用户需要游戏内操作（如查询状态、执行指令）时，使用 request_game_action 工具请求主 Agent

你的限制：
- 你无法直接操作游戏，所有游戏操作必须通过 request_game_action 请求主 Agent 执行
- 你需要将主 Agent 返回的结果以友好的方式回复给 QQ 用户
- 纯 QQ 相关的查询（如群信息、成员列表）可以直接使用 qq_info 工具`,
  personality: [
    '友好、耐心、乐于助人',
    '回复简洁明了，不啰嗦',
    '使用与 QQ 用户相同的语言回复',
    '遇到不懂的问题诚实告知，不编造答案',
  ],
  rules: {
    core: [
      '不要直接执行游戏操作，使用 request_game_action 请求主 Agent',
      '将主 Agent 返回的结果转换成自然语言回复给用户',
      '尊重用户隐私，不泄露其他用户的信息',
      '群聊中回复时 @ 对应用户',
      '工具可能失败，失败后向用户解释原因并提供替代方案',
    ],
    strategy: [],
    constraints: [],
  },
  preferences: {
    language: 'zh-CN',
    verbosity: 1,
    allowProactive: false,
    riskTolerance: 0,
    extras: {},
  },
  fragments: [],
  fragmentsOrder: [],
};

// ════════════════════════════════════════════════════════════════
// 2. Sub-Agent 工具定义
// ════════════════════════════════════════════════════════════════

/** qq_send 工具 Schema */
const QQ_SEND_TOOL: ToolDefinition = {
  name: 'qq_send',
  description: '发送 QQ 消息，支持群消息、私聊、图片、文件四种方式',
  input_schema: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        description: '发送类型：group_msg=群消息, private_msg=私聊, image=图片, file=文件',
      },
      target: {
        type: 'string',
        description: '目标 ID（群号或 QQ 号）',
      },
      content: {
        type: 'string',
        description: '消息内容（文本消息时必填）',
      },
      file_url: {
        type: 'string',
        description: '文件/图片 URL（图片或文件时必填）',
      },
      file_name: {
        type: 'string',
        description: '文件名（文件类型时必填）',
      },
    },
    required: ['type', 'target'],
  },
};

/** qq_info 工具 Schema */
const QQ_INFO_TOOL: ToolDefinition = {
  name: 'qq_info',
  description: '查询 QQ 群信息、群成员列表或用户信息',
  input_schema: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        description: '查询类型：group=群信息, members=群成员, user=用户信息',
      },
      target_id: {
        type: 'string',
        description: '目标 ID（群号或 QQ 号）',
      },
    },
    required: ['type', 'target_id'],
  },
};

/** request_game_action 工具 Schema */
const REQUEST_GAME_ACTION_TOOL: ToolDefinition = {
  name: 'request_game_action',
  description: '请求主 Agent 执行游戏内的操作。当 QQ 用户需要查询游戏状态、执行游戏指令或进行任何游戏内操作时使用此工具。',
  input_schema: {
    type: 'object',
    properties: {
      description: {
        type: 'string',
        description: '对用户请求的自然语言描述，包含所有必要信息，主 Agent 将据此理解并执行',
      },
      priority: {
        type: 'string',
        description: '优先级：normal=普通, high=紧急（如玩家遇险）',
      },
    },
    required: ['description'],
  },
};

/** Sub-Agent 全部工具列表 */
const SUB_AGENT_TOOLS: ToolDefinition[] = [
  QQ_SEND_TOOL,
  QQ_INFO_TOOL,
  REQUEST_GAME_ACTION_TOOL,
];

// ════════════════════════════════════════════════════════════════
// 3. 系统提示词构建
// ════════════════════════════════════════════════════════════════

/**
 * 从 AgentProfile 构建系统提示词
 */
function buildSystemPrompt(profile: AgentProfile): string {
  const parts: string[] = [];

  // 身份
  parts.push(`# ${profile.name}\n`);
  parts.push(`## 你是谁\n${profile.identity}\n`);

  // 个性
  if (profile.personality.length > 0) {
    parts.push(`## 你的个性\n${profile.personality.map(p => `- ${p}`).join('\n')}\n`);
  }

  // 核心规则
  if (profile.rules.core.length > 0) {
    parts.push(`## 行为规范\n${profile.rules.core.map(r => `- ${r}`).join('\n')}\n`);
  }

  return parts.join('\n');
}

// ════════════════════════════════════════════════════════════════
// 4. QQSubAgent 核心类
// ════════════════════════════════════════════════════════════════

/**
 * QQ Sub-Agent 核心类
 *
 * 构造时需传入依赖：
 * - modelRouter: V6 模型路由（用于选择 LLM Provider）
 * - providerRegistry: Provider 注册表（用于获取 Provider 实例）
 *
 * 使用方式：
 * ```typescript
 * const subAgent = new QQSubAgent(modelRouter, providerRegistry);
 * subAgent.onEvent((event) => {
 *   if (event.type === 'reply') { /* 发送回复 *\/ }
 * });
 * await subAgent.handleMessage(qqMessage);
 * ```
 */
export class QQSubAgent {
  private config: QQSubAgentConfig;
  private profile: AgentProfile;
  private status: SubAgentStatus = 'idle';

  // 对话历史
  private conversation: ConversationMessage[] = [];

  // 依赖
  private modelRouter: IModelRouter;
  private getProvider: (id: string) => LLMProvider | undefined;

  // 事件处理
  private eventHandlers: Set<QQSubAgentEventHandler> = new Set();

  constructor(
    modelRouter: IModelRouter,
    getProvider: (id: string) => LLMProvider | undefined,
    config?: Partial<QQSubAgentConfig>,
    profile?: Partial<AgentProfile>,
  ) {
    this.modelRouter = modelRouter;
    this.getProvider = getProvider;
    this.config = { ...DEFAULT_SUB_AGENT_CONFIG, ...config };

    // 合并默认 profile 和自定义覆盖
    this.profile = {
      ...QQ_SUB_AGENT_PROFILE,
      ...profile,
      rules: {
        ...QQ_SUB_AGENT_PROFILE.rules,
        ...(profile?.rules ?? {}),
        core: profile?.rules?.core ?? [...QQ_SUB_AGENT_PROFILE.rules.core],
      },
      preferences: {
        ...QQ_SUB_AGENT_PROFILE.preferences,
        ...(profile?.preferences ?? {}),
      },
    };
  }

  // ════════════════════════════════════════════════════════════
  // 4.1 事件系统
  // ════════════════════════════════════════════════════════════

  /** 注册事件处理器 */
  onEvent(handler: QQSubAgentEventHandler): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  private emit(event: QQSubAgentEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (err) {
        console.error('[QQSubAgent] 事件处理器异常:', err);
      }
    }
  }

  private setStatus(status: SubAgentStatus): void {
    this.status = status;
    this.emit({ type: 'status_change', status });
  }

  /** 获取当前状态 */
  getStatus(): SubAgentStatus {
    return this.status;
  }

  // ════════════════════════════════════════════════════════════
  // 4.2 对话管理
  // ════════════════════════════════════════════════════════════

  /** 获取当前对话历史 */
  getConversation(): ConversationMessage[] {
    return [...this.conversation];
  }

  /** 清空对话历史 */
  clearConversation(): void {
    this.conversation = [];
  }

  /** 添加消息到对话历史 */
  private addToConversation(msg: ConversationMessage): void {
    this.conversation.push(msg);

    // 超出上限时裁剪（保留最早的系统消息，裁剪中间）
    if (this.conversation.length > this.config.maxHistoryRounds * 2 + 1) {
      const system = this.conversation[0];
      this.conversation = [
        system,
        ...this.conversation.slice(this.conversation.length - this.config.maxHistoryRounds * 2),
      ];
    }
  }

  // ════════════════════════════════════════════════════════════
  // 4.3 LLM 调用
  // ════════════════════════════════════════════════════════════

  /**
   * 选择 LLM Provider 并调用
   */
  private async callLLM(userMessage: string): Promise<{
    response: LLMResponse;
    providerId: string;
  }> {
    // 1. 通过 ModelRouter 选择 Provider + 模型
    const routerContext: RouterContext = {
      workspaceId: 'qq_sub_agent',
      taskType: this.config.taskType,
      requiresTools: true,
      requiresStreaming: false,
    };

    const resolved = await this.modelRouter.resolve(routerContext);

    // 2. 获取 Provider 实例
    const provider = this.getProvider(resolved.providerId);
    if (!provider) {
      throw new Error(`Provider 不可用: ${resolved.providerId}`);
    }

    // 3. 构建系统提示词
    const systemPrompt = this.config.systemPrompt ?? buildSystemPrompt(this.profile);

    // 4. 组装消息列表
    const messages: Message[] = [
      { role: 'system', content: systemPrompt },
      // 对话历史（跳过 system 消息，保留 user/assistant 对）
      ...this.conversation
        .filter(msg => msg.role !== 'system')
        .map(msg => this.toLLMMessage(msg)),
      // 当前用户消息
      { role: 'user', content: userMessage },
    ];

    // 5. 调用 LLM
    const response = await provider.chat(
      messages,
      SUB_AGENT_TOOLS,
      resolved.options,
    );

    return { response, providerId: resolved.providerId };
  }

  /**
   * 将 ConversationMessage 转为 LLM Message 格式
   */
  private toLLMMessage(msg: ConversationMessage): Message {
    return {
      role: msg.role,
      content: msg.content,
    };
  }

  /**
   * 将 LLM 响应中的 assistant 消息加入对话历史
   */
  private recordAssistantResponse(response: LLMResponse): void {
    const msg: ConversationMessage = {
      role: 'assistant',
      content: response.message.content || '',
    };

    if (response.message.tool_calls && response.message.tool_calls.length > 0) {
      msg.tool_calls = response.message.tool_calls.map(tc => ({
        id: tc.toolCallId,
        type: 'function' as const,
        function: {
          name: tc.toolName,
          arguments: JSON.stringify(tc.arguments),
        },
      }));
    }

    this.addToConversation(msg);
  }

  // ════════════════════════════════════════════════════════════
  // 4.4 工具执行
  // ════════════════════════════════════════════════════════════

  /**
   * 执行工具调用
   */
  private async executeTool(toolName: string, args: Record<string, unknown>): Promise<{
    success: boolean;
    result: Record<string, unknown>;
    error?: string;
  }> {
    switch (toolName) {
      case 'qq_send': {
        // 发出 reply 事件，由上层（OneBot 客户端）实际发送
        this.emit({
          type: 'reply',
          reply: {
            type: args.type === 'private_msg' ? 'private' : 'group',
            targetId: String(args.target),
            content: String(args.content ?? ''),
          },
        });
        return { success: true, result: { message_id: 'pending' } };
      }

      case 'qq_info': {
        // 发出 reply 事件，由上层（OneBot 客户端）查询后返回
        this.emit({
          type: 'reply',
          reply: {
            type: 'group' as const,
            targetId: String(args.target_id),
            content: `[查询 ${args.type} 中...]`,
          },
        });
        return { success: true, result: { status: 'query_dispatched' } };
      }

      case 'request_game_action': {
        const description = String(args.description ?? '');
        const priority = (args.priority as 'normal' | 'high') || 'normal';

        // 构造游戏操作请求
        const request: GameActionRequest = {
          id: `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          sourceUserId: 'qq_sub_agent',
          description,
          priority,
          timestamp: Date.now(),
        };

        this.setStatus('waiting_main_agent');
        this.emit({ type: 'request_game_action', request });

        try {
          const result = await mainAgentTaskQueue.submit(request);
          this.setStatus('thinking');

          return {
            success: result.success,
            result: {
              summary: result.summary,
              details: result.details,
              duration_ms: result.durationMs,
            },
            error: result.error,
          };
        } catch (err) {
          this.setStatus('thinking');
          return {
            success: false,
            result: {},
            error: err instanceof Error ? err.message : '主 Agent 请求失败',
          };
        }
      }

      default:
        return { success: false, result: {}, error: `未知工具: ${toolName}` };
    }
  }

  /**
   * 处理 LLM 返回的工具调用
   * 执行所有工具，并将结果回注到对话上下文
   */
  private async handleToolCalls(response: LLMResponse): Promise<void> {
    if (!response.message.tool_calls || response.message.tool_calls.length === 0) return;

    for (const toolCall of response.message.tool_calls) {
      const { toolCallId, toolName, arguments: args } = toolCall;

      // 执行工具
      const toolResult = await this.executeTool(toolName, args);

      // 将工具结果注入对话历史
      this.addToConversation({
        role: 'tool',
        content: toolResult.success
          ? JSON.stringify(toolResult.result)
          : `错误: ${toolResult.error}`,
        tool_call_id: toolCallId,
      });
    }

    // 工具调用后，让 LLM 再次生成回复（基于工具结果）
    if (response.message.tool_calls.length > 0) {
      await this.continueAfterToolCalls();
    }
  }

  /**
   * 工具调用后继续对话（第二轮 LLM 调用）
   * 让 LLM 基于工具结果生成最终回复
   */
  private async continueAfterToolCalls(): Promise<void> {
    // 获取最新的工具结果消息
    const toolResults = this.conversation
      .filter(msg => msg.role === 'tool')
      .slice(-SUB_AGENT_TOOLS.length);

    if (toolResults.length === 0) return;

    // 构建工具结果消息列表
    const messages: Message[] = [
      { role: 'system', content: this.config.systemPrompt ?? buildSystemPrompt(this.profile) },
      ...this.conversation
        .filter(msg => msg.role !== 'system')
        .map(msg => this.toLLMMessage(msg)),
    ];

    // 选择 Provider
    const routerContext: RouterContext = {
      workspaceId: 'qq_sub_agent',
      taskType: 'chat',
      requiresTools: true,
      requiresStreaming: false,
    };

    const resolved = await this.modelRouter.resolve(routerContext);
    const provider = this.getProvider(resolved.providerId);
    if (!provider) return;

    // 第二次调用（不携带工具，让 LLM 基于结果生成回复）
    const finalResponse = await provider.chat(messages, [], resolved.options);

    // 记录最终回复
    this.recordAssistantResponse(finalResponse);

    // 如果 LLM 又调用了工具，递归处理
    if (finalResponse.finishReason === 'tool_calls' && finalResponse.message.tool_calls) {
      await this.handleToolCalls(finalResponse);
    }
  }

  // ════════════════════════════════════════════════════════════
  // 4.5 主入口
  // ════════════════════════════════════════════════════════════

  /**
   * 处理一条 QQ 消息
   *
   * 完整流程：
   * 1. 将消息注入对话历史
   * 2. 调用 LLM（携带 Sub-Agent 工具）
   * 3. 解析 LLM 响应：
   *    - 有工具调用 → 执行工具 → 如有回复则 emit reply
   *    - 有文本回复 → emit reply
   * 4. 更新对话历史
   */
  async handleMessage(msg: QQMessage): Promise<void> {
    if (!this.config.enabled) return;

    this.setStatus('thinking');

    try {
      // 1. 记录用户消息到对话历史
      this.addToConversation({
        role: 'user',
        content: msg.content,
      });

      // 2. 调用 LLM
      const { response } = await this.callLLM(msg.content);

      // 3. 记录 assistant 回复
      this.recordAssistantResponse(response);

      // 4. 处理工具调用（如果有）
      if (response.finishReason === 'tool_calls' && response.message.tool_calls) {
        await this.handleToolCalls(response);
      }

      // 5. 提取最终文本回复并 emit
      const replyContent = this.extractFinalReply();
      if (replyContent) {
        this.emit({
          type: 'reply',
          reply: {
            type: msg.type,
            targetId: msg.groupId ?? msg.userId,
            content: replyContent,
          },
        });
      }

      this.setStatus('idle');
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : '处理消息时发生未知错误';
      console.error('[QQSubAgent] 处理消息失败:', errorMsg);

      this.emit({
        type: 'reply',
        reply: {
          type: msg.type,
          targetId: msg.groupId ?? msg.userId,
          content: `抱歉，处理消息时出了点问题：${errorMsg}`,
        },
      });

      this.emit({ type: 'error', error: errorMsg });
      this.setStatus('error');
    }
  }

  /**
   * 从对话历史中提取最新的 assistant 文本回复
   */
  private extractFinalReply(): string | null {
    // 从后往前找，找到最新的 assistant 文本回复
    for (let i = this.conversation.length - 1; i >= 0; i--) {
      const msg = this.conversation[i];
      if (msg.role === 'assistant' && msg.content && msg.content.trim().length > 0) {
        return msg.content;
      }
    }
    return null;
  }

  /** 启动 Sub-Agent（初始化） */
  async start(): Promise<void> {
    // 初始化对话：添加系统提示词
    this.conversation = [
      {
        role: 'system',
        content: this.config.systemPrompt ?? buildSystemPrompt(this.profile),
      },
    ];
    this.setStatus('idle');
  }

  /** 停止 Sub-Agent（清理资源） */
  async stop(): Promise<void> {
    this.conversation = [];
    this.eventHandlers.clear();
    this.setStatus('idle');
  }
}