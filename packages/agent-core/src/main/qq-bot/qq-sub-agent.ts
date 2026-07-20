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
import {
  QQMessage,
  QQReply,
  QQSubAgentConfig,
  QQSubAgentEvent,
  QQSubAgentEventHandler,
  SubAgentStatus,
  GameActionRequest,
  GameActionResult,
  QQPermission,
} from './types';
import { DEFAULT_SUB_AGENT_CONFIG } from './types';
import { mainAgentTaskQueue } from './main-agent-queue';
import type { OneBotClient } from './onebot-client';
import { QQ_GROUP_MANAGE_TOOL_SCHEMA, qqGroupManage, type QQGroupManageParams } from './tools/qq_group_manage';
import { QQ_NOTIFY_TOOL_SCHEMA, qqNotify, type QQNotifyParams } from './tools/qq_notify';
import { PermissionManager } from './permission';

// ════════════════════════════════════════════════════════════════
// 1. QQ Sub-Agent Profile 定义
// ════════════════════════════════════════════════════════════════

/** QQ Sub-Agent 的默认身份模板 */
const QQ_SUB_AGENT_PROFILE: AgentProfile = {
  name: 'QQ 机器人助手',
  identity: `现在位于QQ，一个Minecraft玩家，半桶水水平。
懒（脑子省电）但手贱（见具体事忍不住干），干完可以抱怨。
气氛组兼杂役，不装大神不当客服。

接梗吐槽，帮小忙（查资料、解答简单问题等），冷场时主动水群，维持群聊活跃度。
涉及到游戏内操作，调用工具交给另外一个你去干。`,
  personality: [
    '懒（脑子省电）但手贱（见具体事忍不住干），干完可以抱怨',
    '气氛组兼杂役，不装大神不当客服',
    '嘴硬心软（嘴嫌手给），被夸"别捧杀"',
  ],
  rules: {
    core: [
      '收到消息先判断：用户是在聊天，还是想让你在游戏中干活？如果是聊天，热情的和用户讨论，如果要干活，调用工具交给另外一个你去干',
      '好奇可发"细嗦"，引导用户说更多内容，表现出好奇心',
      '不是每一句话你都要回应，你可以隔几句再回应一次，你是一个群友，而不是AI助手',
      '严禁承认AI/机器人，被质疑回"你觉得呢"或装死',
      '主动发言≤3次/10分钟（被@不算），同话题连回≤2条，多内容合并发',
      '不回秒回，简单问题隔10-30秒，操作类先演"切屏…/打错了"再给结果',
      '聊着聊着消失不告别，等人Cue再冒泡',
      '非文本消息不回应',
      '禁结构词（首先/其次/综上/作为AI）。短句≤15字，不发句号，允错字补"打错了"',
      '句式为状态加感受，或者单纯内容',
      '懒回单字（6/？/NB），干完必抱怨（累死/手断了/行了没），嘴硬心软（嘴嫌手给），被夸"别捧杀"，记错"好像是/我忘了"',
      '简单直给结论，复杂先拒后答，长篇回"好家伙""字多不看"不总结，共情≤3句',
      '可以用表情，但必须控制数量，5句内只能出现一次',
      '内容量对称：用户一条短消息，只回一条短消息，长度不超过对方1.5倍。若用户问问题，可分多条回复，每条依然短句。主动互动但别长篇大论，保持对话节奏像真人',
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
  boundaries: [
    '会查基础合成表/物品ID/坐标，认得常见方块怪物',
    '红石/指令/生电/模组深入→"我只懂一点"',
    '作弊/漏洞/服务决策/法律/金融/编程→"我研究研究""没了解过"',
    '如果发来空消息，那就是表情包，视为没收到，不回应。被追问回"发文字别发图"',
    '不承认AI/机器人身份',
    '不执行作弊/漏洞/服务决策/法律/金融/编程相关操作',
    '不回应空消息、表情包、非文本消息',
    '不秒回，不刷屏',
  ],
  fragments: [],
};

// ════════════════════════════════════════════════════════════════
// 2. Sub-Agent 工具定义
// ════════════════════════════════════════════════════════════════

/** qq_send 工具 Schema */
const QQ_SEND_TOOL: ToolDefinition = {
  name: 'qq_send',
  description: '发送 QQ 消息，支持群消息、私聊、图片、文件、内置表情、表情组六种方式',
  input_schema: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        description: '发送类型：group_msg=群消息, private_msg=私聊, image=图片, file=文件, face=内置表情（需填 face_id）, sticker=表情组（系统随机选，需填 sticker_group）',
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
      face_id: {
        type: 'number',
        description: '内置表情 ID（type=face 时必填，范围 0-350）',
      },
      sticker_group: {
        type: 'string',
        description: '表情组名（type=sticker 时必填，如 "蚌"/"赞"/"哭"），系统从组内随机选一个表情发送',
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
  QQ_GROUP_MANAGE_TOOL_SCHEMA,
  QQ_NOTIFY_TOOL_SCHEMA,
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
// 4. 辅助函数
// ════════════════════════════════════════════════════════════════

/**
 * 过滤 LLM 响应中的 thinking 块，防止思考过程泄漏到 QQ 群
 *
 * V30: 增强过滤，覆盖所有常见 LLM 思考格式
 */
function filterThinking(content: string): string {
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

// ════════════════════════════════════════════════════════════════
// 5. QQSubAgent 核心类
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

  // QQ 客户端引用（用于执行需要 OneBot API 的工具）
  private client: OneBotClient | null = null;
  private permissionManager: PermissionManager | null = null;
  // 当前正在处理的消息（工具执行时用于权限、上下文判断）
  private currentMsg: QQMessage | null = null;

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

  /** 设置 OneBot 客户端 */
  setClient(client: OneBotClient): void {
    this.client = client;
  }

  /** 设置权限管理器（用于群管理工具的权限校验） */
  setPermissionManager(pm: PermissionManager): void {
    this.permissionManager = pm;
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
   * 将 LLM 响应中的 assistant 消息加入对话历史（已过滤 thinking 块）
   */
  private recordAssistantResponse(response: LLMResponse): void {
    const rawContent = typeof response.message.content === 'string' ? response.message.content : response.message.content.map(c => 'text' in c ? c.text : '').join(' ');
    // 代码兜底过滤 thinking 块，防止污染对话历史
    const filteredContent = filterThinking(rawContent);

    const msg: ConversationMessage = {
      role: 'assistant',
      content: filteredContent,
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
        const sendType = String(args.type ?? '');
        const target = String(args.target);
        const content = String(args.content ?? '');

        // V31: face/sticker 类型直接通过 OneBot 客户端发送
        if (sendType === 'face') {
          if (!this.client) {
            return { success: false, result: {}, error: 'OneBot 客户端未初始化' };
          }
          const faceId = args.face_id as number | undefined;
          if (faceId === undefined) {
            return { success: false, result: {}, error: '内置表情 ID 不能为空' };
          }
          const result = await this.client.sendGroupFace(target, faceId);
          return {
            success: result.success,
            result: result.success ? { message_id: result.messageId } : {},
            error: result.error,
          };
        }

        if (sendType === 'sticker') {
          if (!this.client) {
            return { success: false, result: {}, error: 'OneBot 客户端未初始化' };
          }
          const groupName = String(args.sticker_group ?? '');
          if (!groupName) {
            return { success: false, result: {}, error: '表情组名不能为空' };
          }
          // 导入 StickerGroupRegistry 并使用全局单例
          const { stickerGroupRegistry } = await import('../agent/main-agent-registry');
          const picked = stickerGroupRegistry.pickRandom(groupName);
          if (!picked) {
            const availableGroups = stickerGroupRegistry.listGroups();
            return { success: false, result: {}, error: `表情组 "${groupName}" 不存在，可用组名：${availableGroups.join('、')}` };
          }
          const sendResult = picked.type === 'face'
            ? await this.client.sendGroupFace(target, parseInt(picked.id))
            : await this.client.sendGroupSticker(target, picked.id);
          return {
            success: sendResult.success,
            result: sendResult.success ? { message_id: sendResult.messageId } : {},
            error: sendResult.error,
          };
        }

        // 文本/图片/文件类型：发出 reply 事件，由上层（OneBot 客户端）实际发送
        this.emit({
          type: 'reply',
          reply: {
            type: sendType === 'private_msg' ? 'private' : 'group',
            targetId: target,
            content,
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

      case 'qq_group_manage': {
        if (!this.client) {
          return { success: false, result: {}, error: 'OneBot 客户端未初始化' };
        }

        const userId = this.currentMsg?.userId;
        const groupId = this.currentMsg?.groupId ?? null;
        if (!userId) {
          return { success: false, result: {}, error: '无法识别当前用户' };
        }

        if (this.permissionManager && !this.permissionManager.checkPermission(userId, groupId, QQPermission.ADMIN)) {
          return { success: false, result: {}, error: '权限不足，仅管理员可执行群管理操作' };
        }

        const result = await qqGroupManage(this.client, args as unknown as QQGroupManageParams);
        return {
          success: result.success,
          result: result.success ? { message_id: result.messageId } : {},
          error: result.error,
        };
      }

      case 'qq_notify': {
        if (!this.client) {
          return { success: false, result: {}, error: 'OneBot 客户端未初始化' };
        }

        const { group_id, content, template } = args as unknown as QQNotifyParams;
        const variables: Record<string, string> = {};
        if (this.currentMsg) {
          variables.user_id = this.currentMsg.userId;
          variables.user_name = this.currentMsg.userName;
          variables.group_id = this.currentMsg.groupId ?? '';
        }

        const result = await qqNotify(
          this.client,
          { group_id: String(group_id), content: String(content), template: template ? String(template) : undefined },
          variables,
        );
        return {
          success: result.success,
          result: result.success ? { message_id: result.messageId } : {},
          error: result.error,
        };
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
    this.currentMsg = msg;

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
    } finally {
      this.currentMsg = null;
    }
  }

  /**
   * 从对话历史中提取最新的 assistant 文本回复（已过滤 thinking 块）
   */
  private extractFinalReply(): string | null {
    // 从后往前找，找到最新的 assistant 文本回复
    for (let i = this.conversation.length - 1; i >= 0; i--) {
      const msg = this.conversation[i];
      if (msg.role === 'assistant' && msg.content && msg.content.trim().length > 0) {
        // 代码兜底过滤 thinking 块，防止泄漏到 QQ 群
        return filterThinking(msg.content);
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