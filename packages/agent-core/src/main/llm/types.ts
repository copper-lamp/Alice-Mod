/**
 * V6 LLM Provider ×4 + ModelRouter — 类型定义
 *
 * 所有接口定义，V6 提供默认实现，后续版本可通过扩展接口/注册新实现来增强功能。
 */

// ════════════════════════════════════════════════════════════════
// 1. 消息类型
// ════════════════════════════════════════════════════════════════

/** 消息角色 */
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

/** 对话消息 */
export interface Message {
  role: MessageRole;
  content: string | MessageContent[];
  /** 消息 ID（用于追踪和引用） */
  id?: string;
  /** 时间戳 */
  timestamp?: number;
  /** 工具调用 ID（role=tool 时必填，用于匹配工具调用结果） */
  tool_call_id?: string;
}

/** 辅助消息（含可选工具调用） */
export interface AssistantMessage extends Message {
  role: 'assistant';
  tool_calls?: ToolCallContent[];
}

/** 消息内容块类型 */
export type MessageContent = TextContent | ImageContent;

/** 文本内容 */
export interface TextContent {
  type: 'text';
  text: string;
}

/** 图片内容 */
export interface ImageContent {
  type: 'image';
  /** base64 编码的图片数据 */
  data: string;
  /** MIME 类型 */
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  /** 可选描述 */
  alt?: string;
}

/** 工具调用内容 */
export interface ToolCallContent {
  type: 'tool_call';
  /** 工具调用 ID */
  toolCallId: string;
  /** 工具名称 */
  toolName: string;
  /** 工具参数 */
  arguments: Record<string, unknown>;
}

/** 工具执行结果 */
export interface ToolResultContent {
  type: 'tool_result';
  /** 工具调用 ID */
  toolCallId: string;
  /** 执行结果 */
  result: Record<string, unknown>;
  /** 是否执行成功 */
  success: boolean;
  /** 错误信息 */
  error?: string;
}

// ════════════════════════════════════════════════════════════════
// 2. Provider 接口类型
// ════════════════════════════════════════════════════════════════

/** Provider 元数据 */
export interface ProviderMetadata {
  /** Provider 标识符 */
  id: string;
  /** 显示名称 */
  displayName: string;
  /** 支持的模型列表 */
  supportedModels: string[];
  /** 是否支持流式输出 */
  supportsStreaming: boolean;
  /** 是否支持 Function Calling */
  supportsFunctionCalling: boolean;
  /** 是否支持嵌入向量 */
  supportsEmbedding: boolean;
  /** Provider 版本 */
  version: string;
}

/** 聊天选项 */
export interface ChatOptions {
  /** 温度 */
  temperature?: number;
  /** 最大输出 tokens */
  maxTokens?: number;
  /** top_p */
  topP?: number;
  /** 停止标记 */
  stop?: string[];
  /** 额外 Provider 参数 */
  extra?: Record<string, unknown>;
  /** 超时时间（ms） */
  timeout?: number;
  /** 重试次数 */
  retryCount?: number;
  /** 请求标签（用于追踪和日志） */
  requestId?: string;
}

/** Token 消耗统计 */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** 缓存命中 tokens（仅支持缓存的 Provider） */
  cachedTokens?: number;
}

/** LLM 响应 */
export interface LLMResponse {
  /** 响应消息 */
  message: AssistantMessage;
  /** V35: 模型思考过程（如 DeepSeek 的 reasoning_content） */
  thinking?: string;
  /** Token 消耗统计 */
  usage: TokenUsage;
  /** 模型名称 */
  model: string;
  /** 请求 ID */
  requestId: string;
  /** 实际耗时（ms） */
  durationMs: number;
  /** 是否被截断 */
  truncated: boolean;
  /** 结束原因 */
  finishReason: 'stop' | 'length' | 'tool_calls' | 'error';
}

/** LLM 流式 chunk */
export interface LLMChunk {
  /** chunk 内容（文本片段） */
  content: string;
  /** V35: 模型思考过程片段（如 DeepSeek 流式 reasoning_content） */
  thinking?: string;
  /** 工具调用增量（部分 JSON） */
  toolCallDelta?: string;
  /** 当前已累积的 tokens */
  usage?: TokenUsage;
  /** 是否最后一个 chunk */
  isLast: boolean;
  /** 结束原因（仅在 isLast=true 时有值） */
  finishReason?: 'stop' | 'length' | 'tool_calls' | 'error';
}

/** 健康检查结果 */
export interface HealthCheckResult {
  available: boolean;
  latencyMs: number;
  model: string;
  error?: string;
}

// ════════════════════════════════════════════════════════════════
// 3. Provider 接口定义
// ════════════════════════════════════════════════════════════════

/**
 * LLM Provider 统一接口
 * 所有 LLM 服务商必须实现此接口
 */
export interface LLMProvider {
  /** Provider 元数据 */
  readonly metadata: ProviderMetadata;

  /** 发送消息并获取完整响应 */
  chat(
    messages: Message[],
    tools?: ToolDefinition[],
    options?: ChatOptions,
  ): Promise<LLMResponse>;

  /** 流式聊天，逐 chunk 返回 */
  chatStream(
    messages: Message[],
    tools?: ToolDefinition[],
    options?: ChatOptions,
  ): AsyncIterable<LLMChunk>;

  /** 生成嵌入向量（可选） */
  embed?(text: string): Promise<number[]>;

  /** 检查 Provider 可用性 */
  healthCheck(): Promise<HealthCheckResult>;
}

// ════════════════════════════════════════════════════════════════
// 4. 工具定义类型
// ════════════════════════════════════════════════════════════════

/** 工具定义 */
export interface ToolDefinition {
  /** 工具名称 */
  name: string;
  /** 工具描述 */
  description: string;
  /** 工具参数 Schema（JSON Schema 格式） */
  input_schema: {
    type: 'object';
    properties: Record<string, SchemaProperty>;
    required?: string[];
  };
}

/** Schema 属性 */
export interface SchemaProperty {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';
  description?: string;
  enum?: string[];
  items?: SchemaProperty;
  properties?: Record<string, SchemaProperty>;
  required?: string[];
  default?: unknown;
  minimum?: number;
  maximum?: number;
}

// ════════════════════════════════════════════════════════════════
// 5. Provider 注册管理
// ════════════════════════════════════════════════════════════════

/**
 * Provider 注册管理器接口
 */
export interface IProviderRegistry {
  /** 注册一个 Provider */
  register(id: string, provider: LLMProvider): void;

  /** 获取已注册的 Provider */
  get(id: string): LLMProvider | undefined;

  /** 获取所有已注册的 Provider */
  getAll(): Map<string, LLMProvider>;

  /** 获取所有可用 Provider（healthCheck 通过的） */
  getAvailable(): Promise<Array<{ id: string; provider: LLMProvider; latencyMs: number }>>;

  /** 注销 Provider */
  unregister(id: string): void;

  /** 检查 Provider 是否已注册 */
  has(id: string): boolean;

  /** 聚合 healthCheck */
  aggregateHealthCheck(): Promise<Record<string, HealthCheckResult>>;
}

// ════════════════════════════════════════════════════════════════
// 6. 路由类型
// ════════════════════════════════════════════════════════════════

/** 路由上下文 */
export interface RouterContext {
  /** 工作区 ID */
  workspaceId: string;
  /** 当前任务类型 */
  taskType?: 'complex' | 'simple' | 'chat' | 'planning';
  /** 估计需要的 tokens 数 */
  estimatedTokens?: number;
  /** 是否需要 Function Calling */
  requiresTools: boolean;
  /** 是否需要流式输出 */
  requiresStreaming: boolean;
  /** 首选 Provider ID（由调用方指定，如 qqBotModel 的 providerId） */
  providerId?: string;
  /** 首选模型名 */
  model?: string;
}

/** 解析后的模型选择 */
export interface ResolvedModel {
  providerId: string;
  model: string;
  options: ChatOptions;
}

/** 路由规则 */
export interface RouterRule {
  /** 规则名称 */
  name: string;
  /** 匹配条件 */
  match: (context: RouterContext) => boolean;
  /** 路由目标 */
  target: ResolvedModel | 'fallback';
  /** 优先级（数字越大越先匹配） */
  priority: number;
}

/** 路由配置 */
export interface RouterConfig {
  /** 默认路由 */
  default: ResolvedModel;
  /** 按工作区指定的路由（覆盖默认） */
  workspaces?: Record<string, ResolvedModel>;
  /** 按任务类型指定的路由（覆盖默认） */
  taskTypes?: Record<string, ResolvedModel>;
  /** 降级策略 */
  fallback: FallbackStrategy;
}

/** 降级策略 */
export interface FallbackStrategy {
  /** 降级顺序列表 */
  fallbacks: ResolvedModel[];
  /** 降级条件 */
  conditions: {
    /** 连续失败次数超过此值触发降级 */
    maxConsecutiveFailures: number;
    /** 超时时间超过此值触发降级（ms） */
    timeoutThreshold: number;
  };
  /** 降级后恢复检查间隔（ms） */
  recoveryCheckIntervalMs: number;
}

/** 路由统计 */
export interface RouterStats {
  totalResolves: number;
  routeDistribution: Record<string, number>;
  fallbackCount: number;
  fallbackReasons: Record<string, number>;
  avgLatencyMs: number;
}

/**
 * 模型路由选择器接口
 */
export interface IModelRouter {
  /** 根据上下文选择最优 Provider + 模型 */
  resolve(context: RouterContext): Promise<ResolvedModel>;

  /** 注册自定义路由规则 */
  registerRule(rule: RouterRule): void;

  /** 获取当前路由配置 */
  getConfig(): RouterConfig;

  /** 更新路由配置（热更新） */
  updateConfig(config: Partial<RouterConfig>): void;

  /** 获取路由统计 */
  getStats(): RouterStats;

  /** 报告调用结果（成功/失败），用于降级决策 */
  reportResult(providerId: string, success: boolean, error?: string): void;
}

// ════════════════════════════════════════════════════════════════
// 7. 配置管理类型
// ════════════════════════════════════════════════════════════════

/** Provider 配置 */
export interface ProviderConfig {
  /** API 基础地址 */
  baseUrl: string;
  /** API Key（可选，Ollama 不需要） */
  apiKey?: string;
  /** 默认模型 */
  defaultModel: string;
  /** 可选模型列表 */
  models?: string[];
  /** API 版本 */
  apiVersion?: string;
  /** 额外请求头 */
  headers?: Record<string, string>;
  /** 超时配置（ms） */
  timeout?: number;
  /** 最大重试次数 */
  maxRetries?: number;
}

/** 配置变更事件 */
export type ConfigChangeEvent = {
  type: 'provider_added' | 'provider_updated' | 'provider_removed' | 'router_updated';
  providerId?: string;
  timestamp: number;
};

/**
 * LLM 配置管理器接口
 */
export interface ILLMConfigManager {
  /** 获取所有 Provider 配置 */
  getProviderConfigs(): Promise<Record<string, ProviderConfig>>;

  /** 获取指定 Provider 的配置 */
  getProviderConfig(id: string): Promise<ProviderConfig | undefined>;

  /** 更新 Provider 配置 */
  updateProviderConfig(id: string, config: Partial<ProviderConfig>): Promise<void>;

  /** 删除 Provider 配置 */
  removeProviderConfig(id: string): Promise<void>;

  /** 获取路由配置 */
  getRouterConfig(): Promise<RouterConfig>;

  /** 更新路由配置 */
  updateRouterConfig(config: Partial<RouterConfig>): Promise<void>;

  /** 监听配置变更 */
  onConfigChanged(callback: (event: ConfigChangeEvent) => void): void;
}

// ════════════════════════════════════════════════════════════════
// 8. 观测类型
// ════════════════════════════════════════════════════════════════

/** LLM 调用记录 */
export interface LLMCallRecord {
  /** 请求 ID */
  requestId: string;
  /** Provider ID */
  providerId: string;
  /** 模型名称 */
  model: string;
  /** Prompt tokens */
  promptTokens: number;
  /** 输出 tokens */
  completionTokens: number;
  /** 总 tokens */
  totalTokens: number;
  /** 缓存命中 tokens */
  cachedTokens?: number;
  /** 实际耗时（ms） */
  durationMs: number;
  /** 是否成功 */
  success: boolean;
  /** 结束原因 */
  finishReason: string;
  /** 错误信息（success=false 时） */
  error?: string;
  /** 调用时间戳 */
  timestamp: number;
}

/** 调用记录筛选条件 */
export interface CallRecordFilter {
  providerId?: string;
  model?: string;
  success?: boolean;
  workspaceId?: string;
  startTime?: number;
  endTime?: number;
  limit?: number;
  offset?: number;
}

/** Provider 级别的调用统计 */
export interface ProviderCallStats {
  callCount: number;
  totalTokens: number;
  avgDurationMs: number;
  successRate: number;
}

/** 模型级别的调用统计 */
export interface ModelCallStats {
  callCount: number;
  totalTokens: number;
  avgDurationMs: number;
  successRate: number;
}

/** 聚合调用统计 */
export interface CallStats {
  totalCalls: number;
  totalTokens: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalCachedTokens: number;
  avgDurationMs: number;
  successRate: number;
  byProvider: Record<string, ProviderCallStats>;
  byModel: Record<string, ModelCallStats>;
}

/**
 * LLM 调用观测器接口
 */
export interface ILLMObserver {
  /** 包装 Provider 调用，自动记录观测数据 */
  wrap<T>(providerId: string, model: string, call: () => Promise<T>): Promise<T>;

  /** 手动记录一次调用 */
  record(callRecord: LLMCallRecord): void;

  /** 查询调用记录 */
  query(filter?: CallRecordFilter): LLMCallRecord[];

  /** 获取聚合统计 */
  getStats(timeRange?: { start: number; end: number }): CallStats;

  /** 导出调用记录 */
  export(): LLMCallRecord[];

  /** 监听观测事件 */
  onCallRecorded(callback: (record: LLMCallRecord) => void): void;
}

// ════════════════════════════════════════════════════════════════
// 9. 内置 Provider ID 常量
// ════════════════════════════════════════════════════════════════

export const BUILTIN_PROVIDERS = {
  OPENAI: 'openai',
  CLAUDE: 'claude',
  GEMINI: 'gemini',
  OLLAMA: 'ollama',
} as const;

export type BuiltinProviderId = (typeof BUILTIN_PROVIDERS)[keyof typeof BUILTIN_PROVIDERS];

// ════════════════════════════════════════════════════════════════
// 10. 默认配置常量
// ════════════════════════════════════════════════════════════════

export const DEFAULT_CHAT_OPTIONS: ChatOptions = {
  temperature: 0.7,
  maxTokens: 4096,
  topP: 1.0,
  timeout: 60000,
  retryCount: 3,
};

export const DEFAULT_FALLBACK_STRATEGY: FallbackStrategy = {
  fallbacks: [
    { providerId: 'openai', model: 'gpt-4o-mini', options: {} },
    { providerId: 'ollama', model: 'qwen2.5:7b', options: {} },
  ],
  conditions: {
    maxConsecutiveFailures: 3,
    timeoutThreshold: 120000,
  },
  recoveryCheckIntervalMs: 300000,
};

export const DEFAULT_ROUTER_CONFIG: RouterConfig = {
  default: { providerId: 'openai', model: 'gpt-4o', options: { temperature: 0.7 } },
  fallback: DEFAULT_FALLBACK_STRATEGY,
};

export const DEFAULT_PROVIDER_TIMEOUT = 60000;
export const DEFAULT_PROVIDER_MAX_RETRIES = 3;
export const DEFAULT_OBSERVER_MAX_RECORDS = 10000;