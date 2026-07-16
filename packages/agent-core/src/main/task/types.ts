/**
 * V13 任务系统 — 类型定义
 *
 * 所有任务相关类型定义，涵盖 4 种任务类型、6 种任务状态、TaskManager 所有方法的参数/返回值。
 */

// ════════════════════════════════════════════════════════════════
// 1. 核心枚举
// ════════════════════════════════════════════════════════════════

/** 任务类型 */
export type TaskType = 'simple' | 'composite' | 'loop' | 'conditional';

/** 任务状态 */
export type TaskStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

/** 任务优先级 */
export type TaskPriority = 'critical' | 'high' | 'normal' | 'low';

/** 所有 TaskType 的列表 */
export const TASK_TYPES: readonly TaskType[] = ['simple', 'composite', 'loop', 'conditional'];

/** 所有 TaskStatus 的列表 */
export const TASK_STATUSES: readonly TaskStatus[] = ['pending', 'running', 'paused', 'completed', 'failed', 'cancelled'];

/** 所有 TaskPriority 的列表 */
export const TASK_PRIORITIES: readonly TaskPriority[] = ['critical', 'high', 'normal', 'low'];

/** 调度模式 */
export type ScheduleMode = 'immediate' | 'delayed' | 'cron' | 'event';

/** 循环模式 */
export type LoopMode = 'count' | 'interval' | 'condition';

/** 条件类型 */
export type ConditionType = 'time' | 'event' | 'state' | 'expression';

/** 调度事件 */
export type SchedulerEvent =
  | 'task_started'
  | 'task_completed'
  | 'task_failed'
  | 'task_dependency_met'
  | 'queue_empty';

// ════════════════════════════════════════════════════════════════
// 2. 核心实体
// ════════════════════════════════════════════════════════════════

/** 工具调用 */
export interface ToolCall {
  toolName: string;
  parameters: Record<string, any>;
}

/** 循环配置 */
export interface LoopConfig {
  mode: LoopMode;
  count?: number;
  interval?: number;
  condition?: string;
  maxIterations: number;
}

/** 条件配置 */
export interface Condition {
  type: ConditionType;
  value: any;
  description?: string;
}

/** 重试配置 */
export interface RetryConfig {
  maxRetries: number;
  retryDelay: number;
  backoffMultiplier?: number;
}

/** 调度配置 */
export interface ScheduleConfig {
  mode: ScheduleMode;
  delay?: number;
  cron?: string;
  event?: string;
}

/** 任务 — 核心数据模型 */
export interface Task {
  id: string;
  workspaceId: string;
  name: string;
  description: string;
  type: TaskType;
  status: TaskStatus;
  progress: number;
  priority: TaskPriority;
  timeout?: number;
  tags: string[];
  metadata?: Record<string, any>;

  // JSON 字段（按任务类型不同）
  action?: ToolCall;
  subtaskIds?: string[];
  loopConfig?: LoopConfig;
  condition?: Condition;
  retryConfig?: RetryConfig;
  scheduleConfig?: ScheduleConfig;

  // 执行结果
  result?: any;
  error?: string;
  retryCount: number;

  // 依赖
  dependencies?: string[];

  // 时间戳
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  updatedAt: number;
}

// ════════════════════════════════════════════════════════════════
// 3. 创建参数/返回值
// ════════════════════════════════════════════════════════════════

/** 创建任务参数 */
export interface CreateTaskParams {
  workspaceId: string;
  name: string;
  description?: string;
  type: TaskType;
  action?: ToolCall;
  subtaskIds?: string[];
  loopConfig?: LoopConfig;
  condition?: Condition;
  priority?: TaskPriority;
  dependencies?: string[];
  timeout?: number;
  retryConfig?: RetryConfig;
  scheduleConfig?: ScheduleConfig;
  tags?: string[];
  metadata?: Record<string, any>;
}

/** 创建任务结果 */
export interface CreateTaskResult {
  id: string;
  createdAt: number;
}

/** 批量创建参数 */
export interface BatchCreateParams {
  tasks: CreateTaskParams[];
}

/** 批量创建结果 */
export interface BatchCreateResult {
  ids: string[];
  count: number;
}

// ════════════════════════════════════════════════════════════════
// 4. 查询参数/返回值
// ════════════════════════════════════════════════════════════════

/** 查询参数 */
export interface QueryParams {
  id?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  type?: TaskType;
  tags?: string[];
  workspaceId?: string;
  limit?: number;
  offset?: number;
  sortBy?: 'priority' | 'created_at' | 'updated_at' | 'progress';
  sortDir?: 'asc' | 'desc';
}

/** 查询结果 */
export interface QueryResult {
  tasks: Task[];
  total: number;
  limit: number;
  offset: number;
}

/** 分页列表参数 */
export interface ListParams {
  workspaceId?: string;
  limit?: number;
  offset?: number;
}

/** 分页列表结果 */
export interface ListResult {
  tasks: Task[];
  total: number;
  limit: number;
  offset: number;
}

/** 任务进度 */
export interface TaskProgress {
  progress: number;
  status: TaskStatus;
  startedAt?: number;
  completedAt?: number;
}

// ════════════════════════════════════════════════════════════════
// 5. 更新参数
// ════════════════════════════════════════════════════════════════

/** 更新任务参数 */
export interface UpdateTaskParams {
  name?: string;
  description?: string;
  priority?: TaskPriority;
  timeout?: number;
  tags?: string[];
  metadata?: Record<string, any>;
  action?: ToolCall;
  retryConfig?: RetryConfig;
}

// ════════════════════════════════════════════════════════════════
// 6. 调度/依赖管理
// ════════════════════════════════════════════════════════════════

/** 调度结果 */
export interface ScheduleResult {
  id: string;
  scheduledAt: number;
}

/** 队列状态 */
export interface QueueStatus {
  pendingCount: number;
  runningCount: number;
  maxConcurrent: number;
  queue: Array<{ id: string; priority: TaskPriority; waitingFor?: string[] }>;
}

/** 调度事件处理器 */
export type SchedulerEventHandler = (payload: any) => void;

// ════════════════════════════════════════════════════════════════
// 7. 执行器
// ════════════════════════════════════════════════════════════════

/** 执行上下文 */
export interface ExecutionContext {
  workspaceId: string;
  callTool(toolName: string, params: Record<string, any>): Promise<any>;
  getSubTask(id: string): Promise<Task | null>;
  updateProgress(taskId: string, progress: number): Promise<void>;
  log(taskId: string, message: string): Promise<void>;
  abortSignal?: AbortSignal;
}

/** 任务执行结果 */
export interface TaskResult {
  success: boolean;
  data?: any;
  error?: string;
  durationMs: number;
}

/** 任务执行器接口 */
export interface TaskRunner {
  execute(task: Task, context: ExecutionContext): Promise<TaskResult>;
  canExecute(task: Task): Promise<{ ok: boolean; reason?: string }>;
  estimateDuration(task: Task): Promise<number>;
}

// ════════════════════════════════════════════════════════════════
// 8. 任务分解
// ════════════════════════════════════════════════════════════════

/** 分解参数 */
export interface DecomposeParams {
  taskDescription: string;
  context?: Record<string, any>;
  /** 最多分解多少个子任务（默认 10） */
  maxSubtasks?: number;
  /** 分解策略 */
  strategy?: 'sequential' | 'parallel' | 'mixed';
}

/** 分解返回的子任务 */
export interface DecomposedSubTask {
  name: string;
  description: string;
  type: TaskType;
  action?: ToolCall;
  dependencies?: string[];
  priority?: TaskPriority;
  tags?: string[];
}

/** 分解结果 */
export interface DecomposeResult {
  subtasks: DecomposedSubTask[];
  summary: string;
}

// ════════════════════════════════════════════════════════════════
// 9. 统计
// ════════════════════════════════════════════════════════════════

/** 任务统计 */
export interface TaskStats {
  total: number;
  byStatus: Partial<Record<TaskStatus, number>>;
  byType: Partial<Record<TaskType, number>>;
  byPriority: Partial<Record<TaskPriority, number>>;
  completionRate: number;
  averageDurationMs: number;
  totalDurationMs: number;
}

// ════════════════════════════════════════════════════════════════
// 10. 清理参数
// ════════════════════════════════════════════════════════════════

/** 清理选项 */
export interface CleanupOptions {
  /** 保留最近 N 条任务（默认 100） */
  keepRecent?: number;
  /** 清理早于该时间戳的任务 */
  olderThan?: number;
  /** 清理指定状态的任务（默认 completed/failed/cancelled） */
  statuses?: TaskStatus[];
}

/** 清理结果 */
export interface CleanupResult {
  removed: number;
  kept: number;
  details: Array<{ id: string; reason: string }>;
}

// ════════════════════════════════════════════════════════════════
// 11. 导出/导入
// ════════════════════════════════════════════════════════════════

/** 导出选项 */
export interface ExportOptions {
  type?: TaskType;
  status?: TaskStatus;
  ids?: string[];
  workspaceId?: string;
}

/** 导入结果 */
export interface ImportResult {
  imported: number;
  skipped: number;
  errors: Array<{ index: number; reason: string }>;
}

// ════════════════════════════════════════════════════════════════
// 12. 配置
// ════════════════════════════════════════════════════════════════

/** 任务系统配置 */
export interface TaskConfig {
  /** 最大并发任务数（默认 3） */
  maxConcurrent: number;
  /** 默认超时时间（秒，默认 300） */
  defaultTimeout: number;
  /** 调度轮询间隔（ms，默认 1000） */
  pollIntervalMs: number;
  /** 默认重试配置 */
  defaults: {
    retryCount: number;
    retryDelay: number;
    backoffMultiplier: number;
  };
  /** 清理保留最近任务数 */
  cleanupKeepRecent: number;
}

/** 默认任务系统配置 */
export const DEFAULT_TASK_CONFIG: TaskConfig = {
  maxConcurrent: 3,
  defaultTimeout: 300,
  pollIntervalMs: 1000,
  defaults: {
    retryCount: 3,
    retryDelay: 30,
    backoffMultiplier: 2.0,
  },
  cleanupKeepRecent: 100,
};