/**
 * V22 §5.2 PlanManager — Plan CRUD + update_plan 实现
 *
 * 职责：
 *   - 根据 trigger event 创建空 plan（LLM 在第一轮填充）
 *   - 从 LLM response 提取 plan JSON 并落库
 *   - 实现 update_plan 工具的 5 种 operation
 *   - 查询 plan / 判断是否全部完成
 *
 * Agent Core 不对 plan 内容做语义校验（不检查"该 todo 是否合理"），只保证结构合法。
 */

import { randomUUID } from 'node:crypto'
import type { PlanStore } from './plan-store'
import type { ExecutionPlan, PlanTodo, UpdatePlanArgs } from './types'

// ════════════════════════════════════════════════════════════════
// 依赖
// ════════════════════════════════════════════════════════════════

export interface PlanManagerDeps {
  store: PlanStore
  /** 从 LLM response 中提取 plan 的策略（默认按 JSON 块解析） */
  extractor?: (llmResponse: string) => Partial<ExecutionPlan> | undefined
}

/** apply 操作结果 */
export interface ApplyResult {
  ok: boolean
  reason?: string
}

// ════════════════════════════════════════════════════════════════
// 默认 plan 提取器
// ════════════════════════════════════════════════════════════════

/**
 * 默认 plan 提取器：从 LLM response 中查找含 goal + todos 的 JSON 块。
 * 依次尝试 ```json fenced 块、裸 JSON、===PLAN=== 标记块。
 */
export function defaultPlanExtractor(llmResponse: string): Partial<ExecutionPlan> | undefined {
  // 1. 显式标记块 ===PLAN=== ... ===END===
  const marker = llmResponse.match(/={3,}PLAN={3,}\s*([\s\S]*?)\s*={3,}END={3,}/i)
  if (marker) {
    const parsed = tryParsePlanJson(marker[1])
    if (parsed) return parsed
  }
  // 2. fenced ```json 块
  const fenceRe = /```(?:json)?\s*([\s\S]*?)```/gi
  let m: RegExpExecArray | null
  while ((m = fenceRe.exec(llmResponse)) !== null) {
    const parsed = tryParsePlanJson(m[1])
    if (parsed) return parsed
  }
  // 3. 兜底：整段当 JSON 解析
  const direct = tryParsePlanJson(llmResponse)
  if (direct) return direct
  return undefined
}

/** 尝试把一段文本解析为 plan（必须含 goal 字段） */
function tryParsePlanJson(text: string): Partial<ExecutionPlan> | undefined {
  const trimmed = text.trim()
  if (!trimmed.startsWith('{')) return undefined
  try {
    const obj = JSON.parse(trimmed) as Record<string, unknown>
    if (typeof obj.goal === 'string') {
      return obj as Partial<ExecutionPlan>
    }
    return undefined
  } catch {
    return undefined
  }
}

// ════════════════════════════════════════════════════════════════
// PlanManager 类
// ════════════════════════════════════════════════════════════════

export class PlanManager {
  private readonly store: PlanStore
  private readonly extractor: (llmResponse: string) => Partial<ExecutionPlan> | undefined
  /** planId → 关联上下文（用于 save 时写回 workspace/agent/event） */
  private readonly ctxMap = new Map<string, { workspaceId: string; agentId: string; eventId?: string }>()

  constructor(deps: PlanManagerDeps) {
    this.store = deps.store
    this.extractor = deps.extractor ?? defaultPlanExtractor
  }

  // ── 创建 / 提取 ────────────────────────────────────────────────

  /**
   * 根据 trigger event 创建空 plan（无 todos），落库并返回。
   * LLM 在第一轮 respond 时填充 todos。
   */
  createFromEvent(workspaceId: string, agentId: string, eventId?: string): ExecutionPlan {
    const now = Date.now()
    const plan: ExecutionPlan = {
      id: randomUUID(),
      goal: '',
      constraints: [],
      todos: [],
      createdAt: now,
      updatedAt: now,
    }
    this.ctxMap.set(plan.id, { workspaceId, agentId, eventId })
    this.store.save(plan, { workspaceId, agentId, eventId })
    return plan
  }

  /**
   * 从 LLM response 提取 plan（goal + todos + constraints），合并到已存在的 plan 并落库。
   * 解析失败时回退：返回原 plan 不变（不抛错，由上层决定是否降级 simple 模式）。
   */
  ingestFromLLM(planId: string, llmResponse: string): ExecutionPlan {
    const existing = this.store.load(planId)
    if (!existing) {
      throw new Error(`PlanManager.ingestFromLLM: plan not found: ${planId}`)
    }
    const extracted = this.extractor(llmResponse)
    if (!extracted) {
      // 解析失败：保持现状
      return existing
    }
    const merged: ExecutionPlan = {
      ...existing,
      goal: extracted.goal && extracted.goal.length > 0 ? extracted.goal : existing.goal,
      constraints: extracted.constraints ?? existing.constraints,
      todos: extracted.todos && extracted.todos.length > 0
        ? normalizeTodos(extracted.todos)
        : existing.todos,
      updatedAt: Date.now(),
    }
    const ctx = this.ctxMap.get(planId) ?? { workspaceId: '', agentId: '' }
    this.store.save(merged, ctx)
    return merged
  }

  // ── update_plan 工具实现 ───────────────────────────────────────

  /**
   * update_plan 工具的 action handler。
   * 失败场景见 §5.2 表格。
   */
  apply(planId: string, args: UpdatePlanArgs): ApplyResult {
    const plan = this.store.load(planId)
    if (!plan) {
      return { ok: false, reason: `PLAN_NOT_FOUND: ${planId}` }
    }
    const now = Date.now()
    let todos = [...plan.todos]

    switch (args.operation) {
      case 'add': {
        if (!args.newTodo || !args.newTodo.description) {
          return { ok: false, reason: 'ADD_REQUIRES_NEW_TODO' }
        }
        const todo: PlanTodo = {
          id: randomUUID(),
          status: 'pending',
          description: args.newTodo.description,
          expectedTools: args.newTodo.expectedTools,
          dependsOn: args.newTodo.dependsOn,
        }
        todos.push(todo)
        break
      }
      case 'update_status': {
        if (!args.todoId || !args.status) {
          return { ok: false, reason: 'UPDATE_STATUS_REQUIRES_TODO_ID_AND_STATUS' }
        }
        const idx = todos.findIndex(t => t.id === args.todoId)
        if (idx < 0) return { ok: false, reason: `TODO_NOT_FOUND: ${args.todoId}` }
        const cur = todos[idx]
        // completed 是终态，不允许回退
        if (cur.status === 'completed' && args.status !== 'completed') {
          return { ok: false, reason: `TODO_ALREADY_COMPLETED: ${args.todoId}` }
        }
        todos[idx] = {
          ...cur,
          status: args.status,
          completedAt: (args.status === 'completed' || args.status === 'skipped' || args.status === 'failed')
            ? now
            : cur.completedAt,
          failureReason: args.status === 'failed' ? (args.failureReason ?? cur.failureReason) : cur.failureReason,
        }
        // 同步 inProgress：若标记为 in_progress，把上一个 in_progress 退回 pending
        if (args.status === 'in_progress') {
          todos = setInProgress(todos, args.todoId)
        }
        break
      }
      case 'split': {
        if (!args.todoId) return { ok: false, reason: 'SPLIT_REQUIRES_TODO_ID' }
        if (!args.splitInto || args.splitInto.length === 0) {
          return { ok: false, reason: 'SPLIT_REQUIRES_SPLIT_INTO' }
        }
        const idx = todos.findIndex(t => t.id === args.todoId)
        if (idx < 0) return { ok: false, reason: `TODO_NOT_FOUND: ${args.todoId}` }
        const subTodos: PlanTodo[] = args.splitInto.map(s => ({
          id: randomUUID(),
          status: 'pending',
          description: s.description,
          expectedTools: s.expectedTools,
          dependsOn: [args.todoId!],
        }))
        // 用子 todo 替换原 todo
        todos = [...todos.slice(0, idx), ...subTodos, ...todos.slice(idx + 1)]
        break
      }
      case 'reorder': {
        if (!args.newOrder || args.newOrder.length === 0) {
          return { ok: false, reason: 'REORDER_REQUIRES_NEW_ORDER' }
        }
        // 仅 pending 可重排；newOrder 含非 pending id 则拒绝
        const pendingIds = new Set(todos.filter(t => t.status === 'pending').map(t => t.id))
        for (const id of args.newOrder) {
          if (!pendingIds.has(id)) {
            return { ok: false, reason: `REORDER_ONLY_PENDING: ${id}` }
          }
        }
        // 把 pending 按 newOrder 顺序重排，非 pending 保持原位
        const orderMap = new Map(args.newOrder.map((id, i) => [id, i] as const))
        const pendingTodos = todos.filter(t => t.status === 'pending')
          .sort((a, b) => (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0))
        const pendingById = new Map(pendingTodos.map(t => [t.id, t] as const))
        let pendingIdx = 0
        todos = todos.map(t => {
          if (t.status === 'pending') {
            const id = args.newOrder![pendingIdx]
            pendingIdx++
            return pendingById.get(id) ?? t
          }
          return t
        })
        // newOrder 中未覆盖到的 pending 追加到末尾
        const usedIds = new Set(args.newOrder.slice(0, pendingIdx))
        const leftover = pendingTodos.filter(t => !usedIds.has(t.id))
        if (leftover.length > 0) {
          todos = [...todos, ...leftover]
        }
        break
      }
      case 'set_in_progress': {
        if (!args.todoId) return { ok: false, reason: 'SET_IN_PROGRESS_REQUIRES_TODO_ID' }
        const idx = todos.findIndex(t => t.id === args.todoId)
        if (idx < 0) return { ok: false, reason: `TODO_NOT_FOUND: ${args.todoId}` }
        todos = setInProgress(todos, args.todoId)
        break
      }
      default:
        return { ok: false, reason: `UNKNOWN_OPERATION: ${args.operation}` }
    }

    // 持久化
    const updated: ExecutionPlan = { ...plan, todos, updatedAt: now }
    const ctx = this.ctxMap.get(planId) ?? { workspaceId: '', agentId: '' }
    this.store.save(updated, ctx)
    return { ok: true }
  }

  // ── 查询 ──────────────────────────────────────────────────────

  /** 按 planId 查询 */
  get(planId: string): ExecutionPlan | undefined {
    return this.store.load(planId)
  }

  /** 按 eventId 查询 */
  getByEvent(eventId: string): ExecutionPlan | undefined {
    return this.store.loadByEvent(eventId)
  }

  /** 列出某 (workspace, agent) 下的活跃 plan */
  listActive(workspaceId: string, agentId: string): ExecutionPlan[] {
    return this.store.listActive(workspaceId, agentId)
  }

  /** 全部 todo 是否完成（无 pending / in_progress） */
  isAllDone(planId: string): boolean {
    const plan = this.store.load(planId)
    if (!plan) return false
    if (plan.todos.length === 0) return false
    return plan.todos.every(t =>
      t.status === 'completed' || t.status === 'skipped' || t.status === 'failed',
    )
  }
}

// ════════════════════════════════════════════════════════════════
// 辅助函数
// ════════════════════════════════════════════════════════════════

/** 把上一个 in_progress 退回 pending，把目标 todo 标记为 in_progress */
function setInProgress(todos: PlanTodo[], targetId: string): PlanTodo[] {
  return todos.map(t => {
    if (t.id === targetId) {
      return { ...t, status: 'in_progress' as const, completedAt: undefined }
    }
    if (t.status === 'in_progress') {
      return { ...t, status: 'pending' as const }
    }
    return t
  })
}

/** 规范化 LLM 提取的 todos：补 id 与缺省 status */
function normalizeTodos(todos: PlanTodo[]): PlanTodo[] {
  return todos.map(t => ({
    id: t.id && t.id.length > 0 ? t.id : randomUUID(),
    status: t.status ?? 'pending',
    description: t.description,
    expectedTools: t.expectedTools,
    dependsOn: t.dependsOn,
    completedAt: t.completedAt,
    failureReason: t.failureReason,
  }))
}
