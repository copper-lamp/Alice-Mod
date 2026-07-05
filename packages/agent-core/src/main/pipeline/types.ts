/**
 * Function Calling Pipeline 类型定义
 *
 * V4 基础类型 + 接口定义，后续版本通过扩展接口/注册新实现来增强功能。
 */

import type { ToolSchema, ToolResult } from '@mcagent/shared';
import type { JsonRpcRequest, JsonRpcResponse } from '@mcagent/shared';

// ════════════════════════════════════════════════════
// 基础枚举
// ════════════════════════════════════════════════════

/** 管线阶段 */
export enum PipelinePhase {
  Idle = 'idle',
  Parsing = 'parsing',
  Analyzing = 'analyzing',
  Scheduling = 'scheduling',
  MiddlewareBefore = 'middleware-before',
  Dispatching = 'dispatching',
  Collecting = 'collecting',
  Fallback = 'fallback',
  MiddlewareAfter = 'middleware-after',
  Injecting = 'injecting',
  Completed = 'completed',
}

/** 调度策略 */
export type SchedulingStrategy = 'layered' | 'sequential' | 'greedy';

/** 失败策略 */
export type OnErrorStrategy = 'abort' | 'continue';

/** 兜底策略名称 */
export type FallbackStrategyName = 'retry' | 'degrade' | 'skip' | 'abort';

// ════════════════════════════════════════════════════
// LLM 相关类型（后续由 A2/A3 模块完善）
// ════════════════════════════════════════════════════

/** LLM 消息角色 */
export type LLMRole = 'system' | 'user' | 'assistant' | 'tool';

/** LLM 消息内容块 */
export interface LLMContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string };
}

/** LLM 工具调用 */
export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

/** LLM 响应消息 */
export interface LLMMessage {
  role: LLMRole;
  content: string | LLMContentPart[] | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

/** LLM 响应 */
export interface LLMResponse {
  message: LLMMessage;
  finish_reason: 'stop' | 'tool_calls' | 'length' | 'error';
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/** 对话接口（由 LLM 模块实现，管道持有引用） */
export interface Conversation {
  messages: LLMMessage[];
  addMessage(msg: LLMMessage): void;
  getMessages(): LLMMessage[];
}

// ════════════════════════════════════════════════════
// 管道核心类型
// ════════════════════════════════════════════════════

/** 解析后的工具调用 */
export interface ToolCallContent {
  type: 'tool_call';
  toolCallId: string;
  toolName: string;
  arguments: Record<string, unknown>;
}

/** 工具执行结果 */
export interface ToolResultContent {
  type: 'tool_result';
  toolCallId: string;
  toolName?: string;
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
  errorCode?: string;
  durationMs: number;
  /** 兜底标记 */
  resolvedByFallback?: boolean;
  /** 跳过标记 */
  skipped?: boolean;
  /** 取消标记 */
  cancelled?: boolean;
}

/** 执行层级 — 同一层级的工具可并行执行 */
export interface ExecutionLayer {
  level: number;
  calls: ToolCallContent[];
}

/** Batch 调用 */
export interface BatchCall {
  id: string;
  method: string;
  params: {
    tool_name: string;
    parameters: Record<string, unknown>;
    timeout_ms?: number;
  };
}

/** 已调度的 Batch */
export interface ScheduledBatch {
  level: number;
  calls: BatchCall[];
  timeoutMs: number;
}

/** Batch 执行结果 */
export interface BatchExecuteResult {
  results: ToolCallResult[];
  totalDurationMs: number;
}

/** 单个工具调用结果（原始格式） */
export interface ToolCallResult {
  id: string;
  toolName?: string;
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
  errorCode?: string;
  durationMs: number;
}

/** 校验结果 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

// ════════════════════════════════════════════════════
// 管线选项
// ════════════════════════════════════════════════════

/** 管线选项 */
export interface PipelineOptions {
  /** 默认调度选项 */
  schedule?: Partial<ScheduleOptions>;
  /** 默认收集选项 */
  collect?: Partial<CollectOptions>;
  /** 是否启用兜底（默认 true） */
  enableFallback?: boolean;
  /** 管线总超时（ms，默认 120s） */
  timeout?: number;
}

/** 调度选项 */
export interface ScheduleOptions {
  /** 全局超时（ms，默认 60s） */
  globalTimeoutMs: number;
  /** 单层超时（ms，默认 30s） */
  layerTimeoutMs: number;
  /** 失败策略 */
  onError: OnErrorStrategy;
  /** 每层最大并发数（默认 5） */
  maxConcurrency: number;
}

/** 收集选项 */
export interface CollectOptions {
  /** 全局超时（ms，默认 60s） */
  globalTimeoutMs: number;
  /** 层级间等待间隔（ms，默认 100） */
  interLayerDelayMs: number;
  /** 首个失败是否提前返回（默认 false） */
  failFast: boolean;
}

/** 处理选项（每次 process 调用可覆盖默认选项） */
export interface ProcessOptions {
  /** 覆盖默认调度选项 */
  schedule?: Partial<ScheduleOptions>;
  /** 覆盖默认收集选项 */
  collect?: Partial<CollectOptions>;
  /** 请求标签（追踪用） */
  requestId?: string;
}

// ════════════════════════════════════════════════════
// 管线结果
// ════════════════════════════════════════════════════

/** 管线处理结果 */
export interface PipelineResult {
  /** 工具执行结果列表 */
  toolResults: ToolResultContent[];
  /** 总耗时 */
  totalDurationMs: number;
  /** 各阶段耗时明细 */
  phaseDurations: {
    parse: number;
    analyze: number;
    schedule: number;
    middlewareBefore: number;
    dispatch: number;
    collect: number;
    fallback: number;
    middlewareAfter: number;
    inject: number;
  };
  /** 统计 */
  stats: {
    total: number;
    success: number;
    failed: number;
    skipped: number;
    cancelled: number;
    fallbackResolved: number;
  };
  /** 是否有错误 */
  hasErrors: boolean;
  /** 错误列表 */
  errors: PipelineError[];
}

/** 管线错误 */
export interface PipelineError {
  code: string;
  message: string;
  toolName?: string;
  toolCallId?: string;
  stack?: string;
}

/** 管线状态 */
export interface PipelineStatus {
  phase: PipelinePhase;
  startedAt: number | null;
  elapsedMs: number;
  callCount: number;
}

/** 收集结果 */
export interface CollectResult {
  results: ToolResultContent[];
  successCount: number;
  failCount: number;
  totalDurationMs: number;
  toolDurations: Array<{
    toolName: string;
    durationMs: number;
    success: boolean;
  }>;
  hasErrors: boolean;
}

// ════════════════════════════════════════════════════
// 中间件上下文与中间件接口
// ════════════════════════════════════════════════════

/** 中间件上下文 */
export interface MiddlewareContext {
  readonly pipelineId: string;
  readonly workspaceId: string;
  calls: ToolCallContent[];
  layers?: ExecutionLayer[];
  batches?: ScheduledBatch[];
  results?: ToolResultContent[];
  errors?: PipelineError[];
  metadata: Record<string, unknown>;
}

/** 管线中间件接口 */
export interface IPipelineMiddleware {
  readonly name: string;

  /** 前置处理（Batch 发送前执行） */
  before?(context: MiddlewareContext): Promise<MiddlewareContext>;

  /** 后置处理（结果收集后执行） */
  after?(context: MiddlewareContext): Promise<MiddlewareContext>;
}

// ════════════════════════════════════════════════════
// 子组件接口定义
// ════════════════════════════════════════════════════

/** ResponseParser 接口 — 解析 LLM 响应中的工具调用 */
export interface IResponseParser {
  parse(response: LLMResponse): ToolCallContent[];
  validate(call: ToolCallContent, definition: ToolSchema): ValidationResult;
}

/** DependencyAnalyzer 接口 — 分析工具调用间的依赖关系 */
export interface IDependencyAnalyzer {
  analyze(calls: ToolCallContent[]): ExecutionLayer[];
  registerConflictRule(rule: ConflictRule): void;
}

/** BatchScheduler 接口 — 将执行层级转换为 Batch 请求 */
export interface IBatchScheduler {
  schedule(layers: ExecutionLayer[], options?: ScheduleOptions): ScheduledBatch[];
  setStrategy(strategy: SchedulingStrategy): void;
}

/** ToolDispatcher 接口 — 将 Batch 请求发送到对应工作区并执行 */
export interface IToolDispatcher {
  executeBatch(batch: ScheduledBatch, workspaceId: string): Promise<BatchExecuteResult>;
  registerStrategy(name: string, strategy: DispatchStrategy): void;
}

/** ResultCollector 接口 — 收集所有层级的执行结果 */
export interface IResultCollector {
  collect(
    batches: ScheduledBatch[],
    dispatcher: IToolDispatcher,
    workspaceId: string,
    options: CollectOptions,
    abortSignal?: AbortSignal,
  ): Promise<CollectResult>;
  onResult(handler: ResultHandler): void;
}

/** ResultInjector 接口 — 将执行结果回注到 LLM 上下文 */
export interface IResultInjector {
  inject(result: CollectResult, conversation: Conversation): void;
  registerFormatter(toolName: string, formatter: ResultFormatter): void;
}

/** FallbackManager 接口 — 兜底策略管理 */
export interface IFallbackManager {
  handle(
    failedCall: ToolCallContent,
    context: FallbackContext,
  ): Promise<FallbackResult>;
  registerStrategy(name: string, strategy: FallbackStrategy): void;
}

// ════════════════════════════════════════════════════
// 依赖分析相关
// ════════════════════════════════════════════════════

/** 冲突规则 */
export interface ConflictRule {
  name: string;
  /** 判断两个工具是否冲突 */
  check: (a: ToolCallContent, b: ToolCallContent) => boolean;
  priority: number;
}

// ════════════════════════════════════════════════════
// 分发策略
// ════════════════════════════════════════════════════

/** 分发策略 */
export interface DispatchStrategy {
  name: string;
  match(call: ToolCallContent, workspaceId: string): boolean;
  execute(call: ToolCallContent): Promise<ToolCallResult>;
}

// ════════════════════════════════════════════════════
// 兜底相关
// ════════════════════════════════════════════════════

/** 兜底上下文 */
export interface FallbackContext {
  workspaceId: string;
  attemptCount: number;
  previousErrors: string[];
  allResults: ToolResultContent[];
  metadata: Record<string, unknown>;
}

/** 兜底结果 */
export interface FallbackResult {
  result: ToolResultContent;
  strategyUsed: string;
  resolved: boolean;
}

/** 兜底策略 */
export interface FallbackStrategy {
  name: string;
  shouldApply(call: ToolCallContent, context: FallbackContext): boolean;
  execute(call: ToolCallContent, context: FallbackContext): Promise<FallbackResult>;
}

/** 降级子策略（用于 DegradeStrategy 内部） */
export interface DegradeStrategyRule {
  name: string;
  match(error: PipelineError, call: ToolCallContent): boolean;
  execute(call: ToolCallContent, error: PipelineError): Promise<FallbackResult>;
}

// ════════════════════════════════════════════════════
// 回调类型
// ════════════════════════════════════════════════════

export type ResultHandler = (result: ToolResultContent) => void;
export type ResultFormatter = (result: ToolResultContent) => ToolResultContent;

// ════════════════════════════════════════════════════
// 管线事件
// ════════════════════════════════════════════════════

/** 管线事件类型 */
export enum PipelineEvent {
  Start = 'pipeline:start',
  Parsed = 'pipeline:parsed',
  Analyzed = 'pipeline:analyzed',
  BatchSent = 'pipeline:batch-sent',
  ToolCompleted = 'pipeline:tool-completed',
  Fallback = 'pipeline:fallback',
  Complete = 'pipeline:complete',
  Error = 'pipeline:error',
}

/** 事件监听器类型 */
export type PipelineEventListener = (...args: unknown[]) => void;

// ════════════════════════════════════════════════════
// 默认配置常量
// ════════════════════════════════════════════════════

export const DEFAULT_SCHEDULE_OPTIONS: ScheduleOptions = {
  globalTimeoutMs: 60000,
  layerTimeoutMs: 30000,
  onError: 'continue',
  maxConcurrency: 5,
};

export const DEFAULT_COLLECT_OPTIONS: CollectOptions = {
  globalTimeoutMs: 60000,
  interLayerDelayMs: 100,
  failFast: false,
};

export const DEFAULT_PIPELINE_OPTIONS: PipelineOptions = {
  schedule: DEFAULT_SCHEDULE_OPTIONS,
  collect: DEFAULT_COLLECT_OPTIONS,
  enableFallback: true,
  timeout: 120000,
};

/** 重试策略默认值 */
export const DEFAULT_RETRY_OPTIONS = {
  maxRetries: 3,
  initialDelayMs: 1000,
  backoffMultiplier: 2,
  maxDelayMs: 30000,
  retryableErrors: ['timeout', 'network', 'rate_limit', 'instance_busy'] as string[],
};