/**
 * V22 §5.2 PlanStore — Plan SQLite DAO
 *
 * 基于 ISQLiteStore 同步 API（better-sqlite3）实现 orch_plans / orch_plan_todos
 * 两张表的 CRUD。所有方法同步执行。
 *
 * 表结构：
 *   - orch_plans        计划主表（goal / constraints / 时间戳 + workspace/agent/event 关联）
 *   - orch_plan_todos   计划下的待办（plan_id + todo_id 联合主键）
 */

import type { OrchestrationSQLiteStore } from './types'
import type { ExecutionPlan, PlanTodo } from './types'

// ════════════════════════════════════════════════════════════════
// 内部类型：数据库行（snake_case ↔ camelCase 转换桥接）
// ════════════════════════════════════════════════════════════════

interface PlanRow {
  id: string
  workspace_id: string
  agent_id: string
  event_id: string | null
  goal: string
  constraints_json: string
  created_at: number
  updated_at: number
}

interface PlanTodoRow {
  plan_id: string
  todo_id: string
  status: string
  description: string
  expected_tools_json: string | null
  depends_on_json: string | null
  completed_at: number | null
  failure_reason: string | null
}

// ════════════════════════════════════════════════════════════════
// 转换函数
// ════════════════════════════════════════════════════════════════

function todoRowToTodo(row: PlanTodoRow): PlanTodo {
  return {
    id: row.todo_id,
    status: row.status as PlanTodo['status'],
    description: row.description,
    expectedTools: row.expected_tools_json ? JSON.parse(row.expected_tools_json) : undefined,
    dependsOn: row.depends_on_json ? JSON.parse(row.depends_on_json) : undefined,
    completedAt: row.completed_at ?? undefined,
    failureReason: row.failure_reason ?? undefined,
  }
}

function planRowToPlan(row: PlanRow, todos: PlanTodo[]): ExecutionPlan {
  return {
    id: row.id,
    goal: row.goal,
    constraints: JSON.parse(row.constraints_json) as string[],
    todos,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** save 时需要的关联上下文（plan 本身不携带 workspace/agent/event） */
export interface PlanSaveContext {
  workspaceId: string
  agentId: string
  eventId?: string
}

// ════════════════════════════════════════════════════════════════
// PlanStore 类
// ════════════════════════════════════════════════════════════════

export class PlanStore {
  constructor(private readonly db: OrchestrationSQLiteStore) {
    this.initSchema()
  }

  // ── Schema 初始化 ──────────────────────────────────────────────

  /** 初始化表结构（幂等） */
  initSchema(): void {
    this.db.execute(`
      CREATE TABLE IF NOT EXISTS orch_plans (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        event_id TEXT,
        goal TEXT NOT NULL,
        constraints_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_orch_plans_lookup
        ON orch_plans(workspace_id, agent_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_orch_plans_event
        ON orch_plans(event_id);

      CREATE TABLE IF NOT EXISTS orch_plan_todos (
        plan_id TEXT NOT NULL,
        todo_id TEXT NOT NULL,
        status TEXT NOT NULL,
        description TEXT NOT NULL,
        expected_tools_json TEXT,
        depends_on_json TEXT,
        completed_at INTEGER,
        failure_reason TEXT,
        PRIMARY KEY (plan_id, todo_id),
        FOREIGN KEY (plan_id) REFERENCES orch_plans(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_orch_plan_todos_plan
        ON orch_plan_todos(plan_id);
    `)
  }

  // ── CRUD ──────────────────────────────────────────────────────

  /** 保存（upsert）计划及其 todos（先删旧 todos 再写新） */
  save(plan: ExecutionPlan, ctx: PlanSaveContext): void {
    // upsert 主表
    this.db.execute(`
      INSERT INTO orch_plans (id, workspace_id, agent_id, event_id, goal, constraints_json, created_at, updated_at)
      VALUES (@id, @workspace_id, @agent_id, @event_id, @goal, @constraints_json, @created_at, @updated_at)
      ON CONFLICT(id) DO UPDATE SET
        workspace_id = excluded.workspace_id,
        agent_id = excluded.agent_id,
        event_id = excluded.event_id,
        goal = excluded.goal,
        constraints_json = excluded.constraints_json,
        updated_at = excluded.updated_at
    `, {
      id: plan.id,
      workspace_id: ctx.workspaceId,
      agent_id: ctx.agentId,
      event_id: ctx.eventId ?? null,
      goal: plan.goal,
      constraints_json: JSON.stringify(plan.constraints),
      created_at: plan.createdAt,
      updated_at: plan.updatedAt,
    })

    // 重写 todos：先删后插（计划规模小，事务内完成）
    this.db.execute('DELETE FROM orch_plan_todos WHERE plan_id = @plan_id', { plan_id: plan.id })
    for (const todo of plan.todos) {
      this.db.execute(`
        INSERT INTO orch_plan_todos
          (plan_id, todo_id, status, description, expected_tools_json, depends_on_json, completed_at, failure_reason)
        VALUES
          (@plan_id, @todo_id, @status, @description, @expected_tools_json, @depends_on_json, @completed_at, @failure_reason)
      `, {
        plan_id: plan.id,
        todo_id: todo.id,
        status: todo.status,
        description: todo.description,
        expected_tools_json: todo.expectedTools ? JSON.stringify(todo.expectedTools) : null,
        depends_on_json: todo.dependsOn ? JSON.stringify(todo.dependsOn) : null,
        completed_at: todo.completedAt ?? null,
        failure_reason: todo.failureReason ?? null,
      })
    }
  }

  /** 按 planId 加载计划（含 todos） */
  load(planId: string): ExecutionPlan | undefined {
    const rows = this.db.queryAll<PlanRow>(
      'SELECT * FROM orch_plans WHERE id = @id',
      { id: planId },
    )
    if (rows.length === 0) return undefined
    const planRow = rows[0]
    const todoRows = this.db.queryAll<PlanTodoRow>(
      'SELECT * FROM orch_plan_todos WHERE plan_id = @plan_id ORDER BY rowid ASC',
      { plan_id: planId },
    )
    return planRowToPlan(planRow, todoRows.map(todoRowToTodo))
  }

  /** 按 eventId 加载计划 */
  loadByEvent(eventId: string): ExecutionPlan | undefined {
    const rows = this.db.queryAll<PlanRow>(
      'SELECT * FROM orch_plans WHERE event_id = @event_id ORDER BY updated_at DESC LIMIT 1',
      { event_id: eventId },
    )
    if (rows.length === 0) return undefined
    return this.load(rows[0].id)
  }

  /** 列出某 (workspace, agent) 下的活跃计划（含 pending/in_progress todo） */
  listActive(workspaceId: string, agentId: string): ExecutionPlan[] {
    const rows = this.db.queryAll<{ id: string }>(
      `SELECT p.id FROM orch_plans p
       WHERE p.workspace_id = @workspace_id AND p.agent_id = @agent_id
         AND EXISTS (
           SELECT 1 FROM orch_plan_todos t
           WHERE t.plan_id = p.id AND t.status IN ('pending', 'in_progress')
         )
       ORDER BY p.updated_at DESC`,
      { workspace_id: workspaceId, agent_id: agentId },
    )
    const plans: ExecutionPlan[] = []
    for (const r of rows) {
      const p = this.load(r.id)
      if (p) plans.push(p)
    }
    return plans
  }
}
