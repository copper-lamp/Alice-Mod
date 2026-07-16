/**
 * V22 元编排层 — 公共类型定义
 *
 * 参考设计文档 §2（核心概念）与 §5（详细设计）。
 * 所有跨模块共享的接口/类型集中在此声明。
 */

import type { ISQLiteStore } from '../memory/sqlite-store'

// ════════════════════════════════════════════════════════════════
// SQLite 访问接口（元编排层视角）
// ════════════════════════════════════════════════════════════════

/**
 * V22 元编排层使用的 SQLite 访问接口。
 *
 * queryAll 复用 ISQLiteStore.queryAll；execute 对应 ISQLiteStore.run
 * （执行无返回行的 SQL：INSERT/UPDATE/DELETE/DDL）。
 *
 * wiring 时通过适配器把 ISQLiteStore.run 映射为 execute，即可注入本模块。
 */
export interface OrchestrationSQLiteStore extends Pick<ISQLiteStore, 'queryAll'> {
  /** 执行无返回行的 SQL 语句（INSERT / UPDATE / DELETE / DDL） */
  execute(sql: string, params?: Record<string, unknown>): void
}

// ════════════════════════════════════════════════════════════════
// 执行计划文档（§2.1）
// ════════════════════════════════════════════════════════════════

/** 执行计划文档 */
export interface ExecutionPlan {
  /** 计划 ID（Agent Core 在收到第一份计划时分配） */
  id: string
  /** 用户原始任务描述（一句话） */
  goal: string
  /** 任务约束（不可违反项） */
  constraints: string[]
  /** 可动态调整的待办列表 */
  todos: PlanTodo[]
  /** 计划生成时间（ms） */
  createdAt: number
  /** 最近一次 update_plan 的时间（ms） */
  updatedAt: number
}

/** 计划中的单个待办 */
export interface PlanTodo {
  /** 待办 ID（在本计划内稳定，用于 update_plan 引用） */
  id: string
  /** 状态 */
  status: 'pending' | 'in_progress' | 'completed' | 'skipped' | 'failed'
  /** 一句话描述（≤ 80 字） */
  description: string
  /** 实际使用的工具名（可选） */
  expectedTools?: string[]
  /** 依赖的其它 todo id（可选，Agent Core 不强制按依赖调度） */
  dependsOn?: string[]
  /** 完成时间（仅 completed/skipped/failed 时存在） */
  completedAt?: number
  /** 失败原因（仅 failed 时存在） */
  failureReason?: string
}

// ════════════════════════════════════════════════════════════════
// 进展状态（§2.2）
// ════════════════════════════════════════════════════════════════

/** 进展状态：当前 plan 已完成待办摘要的合并浓缩 */
export interface ProgressState {
  /** 关联的 plan id */
  planId: string
  /** 已完成/失败/跳过的 todo 摘要列表（按完成时间倒序，新→旧） */
  completed: Array<{
    todoId: string
    description: string
    status: 'completed' | 'failed' | 'skipped'
    result?: string
    failureReason?: string
    tokenCount: number
  }>
  /** 当前正在做的 todo（仅一个） */
  inProgress?: { todoId: string; description: string }
  /** 上次压缩时间（ms） */
  lastCompressedAt: number
}

// ════════════════════════════════════════════════════════════════
// update_plan 工具参数（§2.3）
// ════════════════════════════════════════════════════════════════

/** update_plan 工具参数 */
export interface UpdatePlanArgs {
  /** 操作类型 */
  operation: 'add' | 'update_status' | 'split' | 'reorder' | 'set_in_progress'
  /** 操作目标（todo id） */
  todoId?: string
  /** 新增的 todo（operation='add'） */
  newTodo?: { description: string; expectedTools?: string[]; dependsOn?: string[] }
  /** 拆分的子 todo（operation='split'） */
  splitInto?: Array<{ description: string; expectedTools?: string[] }>
  /** 状态更新（operation='update_status'） */
  status?: 'pending' | 'in_progress' | 'completed' | 'skipped' | 'failed'
  /** 完成时的关键结果（status='completed' 时可选，节省 token） */
  result?: string
  /** 失败原因（status='failed' 时建议必填） */
  failureReason?: string
  /** 重排目标顺序（operation='reorder'） */
  newOrder?: string[]
}

// ════════════════════════════════════════════════════════════════
// 任务摘要（§2.4）
// ════════════════════════════════════════════════════════════════

/** 单个 todo 完成后的结构化摘要 */
export interface TaskSummary {
  todoId: string
  status: 'completed' | 'failed' | 'skipped'
  /** 关键结果（≤ 40 字） */
  result?: string
  /** 失败原因（仅 failed） */
  failureReason?: string
  /** 是否标记为关键事实（影响压缩配额） */
  critical?: boolean
}

// ════════════════════════════════════════════════════════════════
// 任务记忆（§2.5）
// ════════════════════════════════════════════════════════════════

/** plan 完成后的任务总结 */
export interface TaskMemory {
  planId: string
  /** 一句话目标 */
  goal: string
  /** 完成情况摘要 */
  outcome: 'success' | 'partial' | 'failed' | 'aborted'
  /** 关键决策与结果（≤ 5 条，每条 ≤ 50 字） */
  keyOutcomes: string[]
  /** 失败原因（outcome='failed'） */
  failureReasons?: string[]
  /** 产出物（物品 ID、方块坐标、关键 ID 等可复用信息） */
  artifacts?: Array<{ type: string; ref: string }>
  /** 总耗时（ms） */
  durationMs: number
  /** 总 token 消耗 */
  totalTokens: number
  /** 沉淀时间（ms） */
  committedAt: number
}

// ════════════════════════════════════════════════════════════════
// 技能注入（§2.6 / §5.4）
// ════════════════════════════════════════════════════════════════

/** 技能阶段 */
export type SkillPhase = 'plan' | 'execute' | 'transfer' | 'summarize'

/** 技能定义 */
export interface Skill {
  /** 技能名（e.g. 'plan-mode'） */
  name: string
  /** 所属阶段 */
  phase: SkillPhase
  /** markdown 文档全文 */
  content: string
  /** Agent 默认是否启用（可被 agent.orchestration.skills 覆盖） */
  enabledByDefault: boolean
  /** 估算 token 数（用于预算控制） */
  estimatedTokens: number
}

// ════════════════════════════════════════════════════════════════
// 分层记忆压缩（§2.7 / §5.7）
// ════════════════════════════════════════════════════════════════

/**
 * 压缩档位：按 minAgeDays 升序匹配，第一个 ageDays ≥ minAgeDays 的档位生效。
 * 同一时间窗口内 critical 与 normal 是两个独立档位。
 */
export interface CompressionTier {
  /** 记忆距今的最少天数（ageDays ≥ minAgeDays 时匹配） */
  minAgeDays: number
  /** 重要性 */
  importance: 'normal' | 'critical'
  /** 压缩后允许的最大 token；Infinity 表示不压缩 */
  maxTokens: number
}
