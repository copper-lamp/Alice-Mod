/**
 * 事件触发器模块 — 类型定义
 *
 * V14 新增：统一事件模型、触发器规则、动作定义与日志类型。
 */

// ════════════════════════════════════════════════════════════════
// 1. 事件基础
// ════════════════════════════════════════════════════════════════

/** 触发器来源 */
export type TriggerSource = 'cron' | 'game_chat' | 'plugin_event' | 'qq';

/** 触发器来源列表 */
export const TRIGGER_SOURCES: readonly TriggerSource[] = ['cron', 'game_chat', 'plugin_event', 'qq'];

/** 事件来源（含系统内部事件） */
export type EventSource = TriggerSource | 'system';

/** Agent 事件 */
export interface AgentEvent {
  /** 事件唯一 ID */
  id: string;
  /** 事件类型，如 game_chat / player_hurt / qq.at_bot */
  type: string;
  /** 事件来源 */
  source: EventSource;
  /** 工作区 ID，空字符串表示全局 */
  workspaceId: string;
  /** 事件时间戳（毫秒） */
  timestamp: number;
  /** 事件负载 */
  payload: Record<string, unknown>;
  /** 额外元数据 */
  metadata?: Record<string, unknown>;
}

// ════════════════════════════════════════════════════════════════
// 2. 触发器规则
// ════════════════════════════════════════════════════════════════

/** 规则类型 */
export type TriggerRuleType =
  | 'keyword'
  | 'regex'
  | 'event_type'
  | 'payload_field'
  | 'at_bot'
  | 'private_msg'
  | 'cron'
  | 'interval'
  | 'random_window'
  | 'composite'
  | 'always';

/** Payload 字段比较操作符 */
export type PayloadOperator =
  | 'eq'
  | 'ne'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'contains'
  | 'starts_with'
  | 'ends_with'
  | 'in'
  | 'not_in';

/** Payload 字段规则 */
export interface PayloadFieldRule {
  /** 字段路径，支持点号嵌套，如 player.health */
  key: string;
  /** 比较操作符 */
  op: PayloadOperator;
  /** 目标值 */
  value: unknown;
}

/** 组合规则操作符 */
export type CompositeOperator = 'and' | 'or';

/** 触发器规则 */
export interface TriggerRule {
  /** 规则类型 */
  type: TriggerRuleType;
  /** 简单规则的值（keyword / regex / event_type / cron 等） */
  value?: unknown;
  /** Payload 字段规则 */
  field?: PayloadFieldRule;
  /** 组合规则的子条件 */
  conditions?: TriggerRule[];
  /** 组合规则操作符 */
  operator?: CompositeOperator;
}

// ════════════════════════════════════════════════════════════════
// 3. 触发器动作
// ════════════════════════════════════════════════════════════════

/** 动作类型 */
export type TriggerActionType =
  | 'create_task'
  | 'call_tool'
  | 'send_llm'
  | 'send_qq'
  | 'store_memory'
  | 'none';

/** 创建任务动作配置 */
export interface CreateTaskActionConfig {
  /** 任务名称 */
  name?: string;
  /** 任务描述 */
  description?: string;
  /** 任务类型 */
  taskType?: 'simple' | 'composite' | 'loop' | 'conditional';
  /** 任务优先级 */
  priority?: 'critical' | 'high' | 'normal' | 'low';
  /** 工具调用 */
  action?: { toolName: string; parameters: Record<string, unknown> };
  /** 任务标签 */
  tags?: string[];
  /** 额外元数据 */
  metadata?: Record<string, unknown>;
}

/** 调用工具动作配置 */
export interface CallToolActionConfig {
  toolName: string;
  parameters?: Record<string, unknown>;
}

/** 发送 LLM 动作配置 */
export interface SendLLMActionConfig {
  /** 目标：main / qq_sub_agent */
  target: 'main' | 'qq_sub_agent';
  /** 提示词模板，支持占位符如 {{event.payload.message}} */
  prompt: string;
  /** 是否自动注入事件上下文 */
  includeEventContext?: boolean;
}

/** 发送 QQ 动作配置 */
export interface SendQQActionConfig {
  /** 目标群号或 QQ 号 */
  target: string;
  /** 消息内容模板 */
  content: string;
  /** 消息类型 */
  messageType?: 'group' | 'private';
}

/** 存储记忆动作配置 */
export interface StoreMemoryActionConfig {
  /** 记忆类型 */
  memoryType: string;
  /** 记忆分支 */
  branch?: string;
  /** 记忆内容模板 */
  content: string;
  /** 重要性 1-10 */
  importance?: number;
  /** 标签 */
  tags?: string[];
}

/** 触发器动作 */
export interface TriggerAction {
  /** 动作类型 */
  type: TriggerActionType;
  /** 动作配置 */
  config: CreateTaskActionConfig | CallToolActionConfig | SendLLMActionConfig | SendQQActionConfig | StoreMemoryActionConfig | Record<string, unknown>;
}

/** 动作执行结果 */
export interface ActionResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

// ════════════════════════════════════════════════════════════════
// 4. 触发器实体
// ════════════════════════════════════════════════════════════════

/** 触发器实体 */
export interface EventTrigger {
  id: string;
  workspaceId: string;
  name: string;
  description: string;
  enabled: boolean;
  source: TriggerSource;
  priority: number;
  rule: TriggerRule;
  action: TriggerAction;
  cooldownSeconds: number;
  maxTriggerCount?: number;
  triggerCount: number;
  lastTriggeredAt?: number;
  createdAt: number;
  updatedAt: number;
  /** V20：target='qq_sub_agent' 时指向具体 agent；其他 target 不使用 */
  targetAgentId?: string;
  /** V22：是否强制使用复杂模式（plan-execute 闭环） */
  complex?: boolean;
}

/** 创建触发器参数 */
export interface CreateTriggerParams {
  workspaceId?: string;
  name: string;
  description?: string;
  source: TriggerSource;
  priority?: number;
  rule: TriggerRule;
  action: TriggerAction;
  cooldownSeconds?: number;
  maxTriggerCount?: number;
  enabled?: boolean;
  /** V20：target='qq_sub_agent' 时指定具体 agent */
  targetAgentId?: string;
}

/** 更新触发器参数 */
export interface UpdateTriggerParams {
  name?: string;
  description?: string;
  enabled?: boolean;
  priority?: number;
  rule?: TriggerRule;
  action?: TriggerAction;
  cooldownSeconds?: number;
  maxTriggerCount?: number;
  /** V20：target='qq_sub_agent' 时指定具体 agent */
  targetAgentId?: string;
}

/** 触发器匹配结果 */
export interface TriggerMatch {
  trigger: EventTrigger;
  event: AgentEvent;
  matchedRule: TriggerRule;
}

/** 触发器查询参数 */
export interface ListTriggerOptions {
  workspaceId?: string;
  source?: TriggerSource;
  enabled?: boolean;
  limit?: number;
  offset?: number;
}

// ════════════════════════════════════════════════════════════════
// 5. 触发器日志
// ════════════════════════════════════════════════════════════════

/** 触发器日志 */
export interface TriggerLog {
  id: number;
  triggerId: string;
  eventType: string;
  eventPayload?: Record<string, unknown>;
  action: TriggerAction;
  success: boolean;
  error?: string;
  triggeredAt: number;
}

// ════════════════════════════════════════════════════════════════
// 6. 事件 Payload
// ════════════════════════════════════════════════════════════════

/** 游戏聊天事件 Payload */
export interface GameChatPayload {
  playerId: string;
  playerName: string;
  message: string;
  rawMessage: string;
  isAtBot: boolean;
  timestamp: number;
  workspaceId: string;
}

/** 插件事件 Payload */
export interface PluginEventPayload {
  eventType: string;
  workspaceId: string;
  entityId?: string;
  position?: {
    x: number;
    y: number;
    z: number;
    dimension: string;
  };
  data: Record<string, unknown>;
}

/** QQ 消息事件 Payload */
export interface QQEventPayload {
  messageId: string;
  type: 'group' | 'private';
  groupId?: string;
  userId: string;
  userName: string;
  content: string;
  rawContent: string;
  isAtBot: boolean;
  isPrivate: boolean;
  timestamp: number;
}

// ════════════════════════════════════════════════════════════════
// 7. 事件总线
// ════════════════════════════════════════════════════════════════

/** 事件过滤器 */
export interface EventFilter {
  type?: string;
  source?: EventSource;
  workspaceId?: string;
}

/** 事件处理器 */
export type EventHandler = (event: AgentEvent) => Promise<void> | void;

/** 事件总线接口 */
export interface IEventBus {
  publish(event: AgentEvent): void;
  subscribe(filter: EventFilter, handler: EventHandler): () => void;
  on(eventType: string, handler: EventHandler): () => void;
  clear(): void;
}

// ════════════════════════════════════════════════════════════════
// 8. 触发器存储
// ════════════════════════════════════════════════════════════════

/** 触发器存储接口 */
export interface ITriggerStore {
  create(params: CreateTriggerParams, schedule?: TriggerSchedule): EventTrigger;
  update(id: string, params: UpdateTriggerParams): EventTrigger | null;
  delete(id: string): boolean;
  getById(id: string): EventTrigger | null;
  list(options?: ListTriggerOptions): EventTrigger[];
  incrementTriggerCount(id: string): void;
  logExecution(log: Omit<TriggerLog, 'id'>): void;
  getLogs(triggerId: string, limit?: number): TriggerLog[];
  cleanupLogs(maxAgeDays?: number, maxPerTrigger?: number): void;
  getSchedule(triggerId: string): TriggerSchedule | null;
  saveSchedule(schedule: TriggerSchedule): void;
  deleteSchedule(triggerId: string): void;
}

/** 定时调度配置 */
export interface TriggerSchedule {
  triggerId: string;
  scheduleType: 'cron' | 'at' | 'interval';
  cronExpression?: string;
  scheduledAt?: number;
  intervalSeconds?: number;
  lastScheduledAt?: number;
  nextScheduledAt?: number;
}

// ════════════════════════════════════════════════════════════════
// 9. 触发器适配器
// ════════════════════════════════════════════════════════════════

/** 触发器适配器接口 */
export interface TriggerAdapter {
  readonly source: TriggerSource;
  start(): Promise<void>;
  stop(): Promise<void>;
  handle(rawEvent: unknown): AgentEvent | null;
}

// ════════════════════════════════════════════════════════════════
// 10. 动作执行器依赖
// ════════════════════════════════════════════════════════════════

/** 动作执行器依赖 */
export interface ActionExecutorDeps {
  taskManager?: {
    create: (params: {
      workspaceId: string;
      name: string;
      description?: string;
      type: 'simple' | 'composite' | 'loop' | 'conditional';
      priority?: 'critical' | 'high' | 'normal' | 'low';
      action?: { toolName: string; parameters: Record<string, unknown> };
      tags?: string[];
      metadata?: Record<string, unknown>;
    }) => Promise<{ id: string }>;
  };
  callTool?: (workspaceId: string, toolName: string, params: Record<string, unknown>) => Promise<unknown>;
  /** 旧式 LLM 调用（V20 之后由 mainAgentProvider + resolveTarget 替代，保留兼容） */
  sendLLM?: (target: 'main' | 'qq_sub_agent', prompt: string, event: AgentEvent) => Promise<string>;
  sendQQ?: (target: string, content: string, messageType: 'group' | 'private') => Promise<boolean>;
  storeMemory?: (workspaceId: string, params: StoreMemoryActionConfig) => Promise<void>;
  /** V20：解析 send_llm target='main' / 'qq_sub_agent' → (workspaceId, agentId) */
  resolveTarget?: (
    target: 'main' | 'qq_sub_agent',
    event: AgentEvent,
    trigger?: EventTrigger,
  ) => { workspaceId: string; agentId: string } | undefined;
  /**
   * V20：按 (workspaceId, agentId) 拿 MainAgent 实例。
   * 注：返回类型用结构化形状，避免直接 import 还未创建的 main-agent.ts 模块（循环依赖）。
   * 实际 MainAgent 类实现见 src/main/agent/main-agent.ts。
   */
  mainAgentProvider?: (params: {
    workspaceId: string;
    agentId: string;
  }) => {
    handle: (event: {
      source: 'trigger' | 'qq' | 'debug' | 'system';
      prompt: string;
      metadata?: Record<string, unknown>;
    }) => Promise<unknown>;
  } | undefined;
  /**
   * V22：按 (workspaceId, agentId) 拿 Orchestrator 实例（优先于 mainAgentProvider）。
   * Orchestrator 包装 MainAgent.handle，增加 plan/progress/skill 注入。
   */
  orchestratorProvider?: (params: {
    workspaceId: string;
    agentId: string;
  }) => {
    dispatch: (event: {
      source: 'trigger' | 'qq' | 'debug' | 'system';
      prompt: string;
      metadata?: Record<string, unknown>;
    }) => Promise<unknown>;
  } | undefined;
}
