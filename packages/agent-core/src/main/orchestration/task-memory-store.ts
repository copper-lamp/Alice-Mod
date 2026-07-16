/**
 * V22 §5.8 TaskMemoryStore — 任务记忆持久化
 *
 * 基于 ISQLiteStore 同步 API（better-sqlite3）实现 task_memories 表的 CRUD。
 * append/load/list 声明为 async 以匹配任务签名（内部仍是同步调用）。
 *
 * Store 在构造时绑定 (workspaceId, agentId)，append 直接复用绑定值；
 * list 额外接受 (workspaceId, agentId) 以支持跨 (workspace, agent) 查询。
 *
 * 表结构见 §5.8 schema。
 */

import { randomUUID } from 'node:crypto'
import type { OrchestrationSQLiteStore } from './types'
import type { TaskMemory } from './types'

// ════════════════════════════════════════════════════════════════
// 内部类型：数据库行
// ════════════════════════════════════════════════════════════════

interface TaskMemoryRow {
  id: string
  workspace_id: string
  agent_id: string
  plan_id: string
  goal: string
  outcome: string
  key_outcomes_json: string
  failure_reasons_json: string | null
  artifacts_json: string | null
  duration_ms: number
  total_tokens: number
  committed_at: number
}

// ════════════════════════════════════════════════════════════════
// 转换函数
// ════════════════════════════════════════════════════════════════

function rowToTaskMemory(row: TaskMemoryRow): TaskMemory {
  return {
    planId: row.plan_id,
    goal: row.goal,
    outcome: row.outcome as TaskMemory['outcome'],
    keyOutcomes: JSON.parse(row.key_outcomes_json) as string[],
    failureReasons: row.failure_reasons_json ? (JSON.parse(row.failure_reasons_json) as string[]) : undefined,
    artifacts: row.artifacts_json ? (JSON.parse(row.artifacts_json) as Array<{ type: string; ref: string }>) : undefined,
    durationMs: row.duration_ms,
    totalTokens: row.total_tokens,
    committedAt: row.committed_at,
  }
}

// ════════════════════════════════════════════════════════════════
// TaskMemoryStore 类
// ════════════════════════════════════════════════════════════════

export interface TaskMemoryListOpts {
  limit?: number
  beforeCommittedAt?: number
}

export class TaskMemoryStore {
  constructor(
    private readonly db: OrchestrationSQLiteStore,
    private readonly _workspaceId: string,
    private readonly _agentId: string,
  ) {
    this.initSchema()
  }

  /** 绑定的 workspaceId（供 LongTermMemoryHook 写入记忆分区时使用） */
  get workspaceId(): string {
    return this._workspaceId
  }

  /** 绑定的 agentId */
  get agentId(): string {
    return this._agentId
  }

  // ── Schema 初始化 ──────────────────────────────────────────────

  initSchema(): void {
    this.db.execute(`
      CREATE TABLE IF NOT EXISTS task_memories (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        plan_id TEXT NOT NULL,
        goal TEXT NOT NULL,
        outcome TEXT NOT NULL,
        key_outcomes_json TEXT NOT NULL,
        failure_reasons_json TEXT,
        artifacts_json TEXT,
        duration_ms INTEGER NOT NULL,
        total_tokens INTEGER NOT NULL,
        committed_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_task_memories_lookup
        ON task_memories(workspace_id, agent_id, committed_at DESC);
      CREATE INDEX IF NOT EXISTS idx_task_memories_plan
        ON task_memories(plan_id);
    `)
  }

  // ── CRUD ──────────────────────────────────────────────────────

  /** 追加任务记忆，返回生成的 id */
  async append(mem: TaskMemory): Promise<string> {
    const id = randomUUID()
    this.db.execute(`
      INSERT INTO task_memories
        (id, workspace_id, agent_id, plan_id, goal, outcome,
         key_outcomes_json, failure_reasons_json, artifacts_json,
         duration_ms, total_tokens, committed_at)
      VALUES
        (@id, @workspace_id, @agent_id, @plan_id, @goal, @outcome,
         @key_outcomes_json, @failure_reasons_json, @artifacts_json,
         @duration_ms, @total_tokens, @committed_at)
    `, {
      id,
      workspace_id: this.workspaceId,
      agent_id: this.agentId,
      plan_id: mem.planId,
      goal: mem.goal,
      outcome: mem.outcome,
      key_outcomes_json: JSON.stringify(mem.keyOutcomes),
      failure_reasons_json: mem.failureReasons ? JSON.stringify(mem.failureReasons) : null,
      artifacts_json: mem.artifacts ? JSON.stringify(mem.artifacts) : null,
      duration_ms: mem.durationMs,
      total_tokens: mem.totalTokens,
      committed_at: mem.committedAt,
    })
    return id
  }

  /** 按 id 加载任务记忆 */
  async load(id: string): Promise<TaskMemory | undefined> {
    const rows = this.db.queryAll<TaskMemoryRow>(
      'SELECT * FROM task_memories WHERE id = @id',
      { id },
    )
    if (rows.length === 0) return undefined
    return rowToTaskMemory(rows[0])
  }

  /** 列出某 (workspace, agent) 下的任务记忆（按 committed_at 倒序） */
  async list(
    workspaceId: string,
    agentId: string,
    opts: TaskMemoryListOpts = {},
  ): Promise<TaskMemory[]> {
    const conditions: string[] = ['workspace_id = @workspace_id', 'agent_id = @agent_id']
    const params: Record<string, unknown> = {
      workspace_id: workspaceId,
      agent_id: agentId,
    }
    if (opts.beforeCommittedAt !== undefined) {
      conditions.push('committed_at < @before_committed_at')
      params.before_committed_at = opts.beforeCommittedAt
    }
    const limit = opts.limit ?? 50
    params.limit = limit
    const sql = `SELECT * FROM task_memories WHERE ${conditions.join(' AND ')} ORDER BY committed_at DESC LIMIT @limit`
    const rows = this.db.queryAll<TaskMemoryRow>(sql, params)
    return rows.map(rowToTaskMemory)
  }
}
