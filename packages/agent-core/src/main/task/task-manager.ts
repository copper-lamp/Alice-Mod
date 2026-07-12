/**
 * TaskManager — 任务系统统一 API
 *
 * 封装 SQLite 操作，提供 CRUD + 调度 + 统计等完整接口。
 * 所有操作同步执行（better-sqlite3 同步 API）。
 */

import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import type { ISQLiteStore } from '../memory/sqlite-store'
import {
  TaskScheduler,
  type TaskSchedulerEvents,
} from './task-scheduler'
import { TimeoutManager } from './timeout-manager'
import { TaskExecutor } from './executors'
import type { ExecutionContext } from './executors'
import type {
  Task, TaskType, TaskStatus, TaskPriority, TaskConfig,
  CreateTaskParams, CreateTaskResult, BatchCreateParams, BatchCreateResult,
  QueryParams, QueryResult, ListParams, ListResult, TaskProgress,
  UpdateTaskParams, ScheduleResult, QueueStatus, TaskStats,
  CleanupOptions, CleanupResult, ExportOptions, ImportResult,
  DecomposeParams, DecomposeResult, DecomposedSubTask,
  ToolCall, RetryConfig, ScheduleConfig,
} from './types'
import { DEFAULT_TASK_CONFIG } from './types'

// ════════════════════════════════════════════════════════════════
// 内部类型：数据库行（snake_case ↔ camelCase 转换桥接）
// ════════════════════════════════════════════════════════════════

interface TaskMetaRow {
  id: string
  workspace_id: string
  name: string
  description: string
  type: string
  status: string
  progress: number
  priority: string
  timeout: number | null
  tags: string
  metadata: string | null
  action_json: string | null
  subtask_ids: string | null
  loop_config_json: string | null
  condition_json: string | null
  retry_config_json: string | null
  schedule_config_json: string | null
  result_json: string | null
  error: string | null
  retry_count: number
  created_at: number
  started_at: number | null
  completed_at: number | null
  updated_at: number
}

interface DepRow {
  task_id: string
  depends_on_id: string
}

// ════════════════════════════════════════════════════════════════
// 转换函数
// ════════════════════════════════════════════════════════════════

function rowToTask(row: TaskMetaRow, deps?: string[]): Task {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    description: row.description,
    type: row.type as TaskType,
    status: row.status as TaskStatus,
    progress: row.progress,
    priority: row.priority as TaskPriority,
    timeout: row.timeout ?? undefined,
    tags: JSON.parse(row.tags) as string[],
    metadata: row.metadata ? JSON.parse(row.metadata) as Record<string, any> : undefined,
    action: row.action_json ? JSON.parse(row.action_json) as ToolCall : undefined,
    subtaskIds: row.subtask_ids ? JSON.parse(row.subtask_ids) as string[] : undefined,
    loopConfig: row.loop_config_json ? JSON.parse(row.loop_config_json) : undefined,
    condition: row.condition_json ? JSON.parse(row.condition_json) : undefined,
    retryConfig: row.retry_config_json ? JSON.parse(row.retry_config_json) : undefined,
    scheduleConfig: row.schedule_config_json ? JSON.parse(row.schedule_config_json) : undefined,
    result: row.result_json ? JSON.parse(row.result_json) : undefined,
    error: row.error ?? undefined,
    retryCount: row.retry_count,
    createdAt: row.created_at,
    startedAt: row.started_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    updatedAt: row.updated_at,
    dependencies: deps,
  }
}

// ════════════════════════════════════════════════════════════════
// 状态机校验
// ════════════════════════════════════════════════════════════════

const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  pending: ['running', 'paused', 'cancelled'],
  running: ['completed', 'failed', 'paused'],
  paused: ['pending', 'cancelled'],
  completed: [],
  failed: ['pending'], // 重试时 back to pending
  cancelled: [],
}

function validateTransition(from: TaskStatus, to: TaskStatus): void {
  const allowed = VALID_TRANSITIONS[from]
  if (!allowed.includes(to)) {
    throw new Error(`非法状态转换: ${from} → ${to}`)
  }
}

// ════════════════════════════════════════════════════════════════
// TaskManager 类
// ════════════════════════════════════════════════════════════════

export class TaskManager {
  public readonly sqlite: ISQLiteStore
  public readonly scheduler: TaskScheduler
  public readonly timeoutManager: TimeoutManager
  public readonly executor: TaskExecutor
  public readonly events: EventEmitter

  private config: TaskConfig
  private logger: { warn: (msg: string, err?: unknown) => void; info: (msg: string) => void; error: (msg: string, err?: unknown) => void }

  constructor(
    config: Partial<TaskConfig> = {},
    deps?: {
      sqlite?: ISQLiteStore
      logger?: { warn: (msg: string, err?: unknown) => void; info: (msg: string) => void; error: (msg: string, err?: unknown) => void }
    },
  ) {
    this.config = { ...DEFAULT_TASK_CONFIG, ...config }
    this.logger = deps?.logger ?? {
      warn: (msg) => console.warn(`[TaskManager] ${msg}`),
      info: (msg) => console.info(`[TaskManager] ${msg}`),
      error: (msg, err) => console.error(`[TaskManager] ${msg}`, err),
    }

    if (!deps?.sqlite) {
      throw new Error('TaskManager 需要 SQLiteStore 实例')
    }

    this.sqlite = deps.sqlite
    this.events = new EventEmitter()
    this.timeoutManager = new TimeoutManager()
    this.executor = new TaskExecutor()
    this.scheduler = new TaskScheduler(
      { maxConcurrent: this.config.maxConcurrent, pollIntervalMs: this.config.pollIntervalMs },
      {
        sqlite: this.sqlite,
        executeTask: (task) => this.executeTaskWithTimeout(task),
        logger: this.logger,
      },
    )

    // 转发调度事件
    this.scheduler.on('task_completed', (payload) => {
      this.events.emit('task_completed', payload)
    })
    this.scheduler.on('task_failed', (payload) => {
      this.events.emit('task_failed', payload)
    })
  }

  // ══════════════════════════════════════════════════════════════
  // 初始化
  // ══════════════════════════════════════════════════════════════

  init(): void {
    this.scheduler.start()
    this.logger.info('TaskManager 初始化完成')
  }

  // ══════════════════════════════════════════════════════════════
  // 创建
  // ══════════════════════════════════════════════════════════════

  private buildTask(params: CreateTaskParams): Task {
    const now = Math.floor(Date.now() / 1000)
    return {
      id: randomUUID(),
      workspaceId: params.workspaceId,
      name: params.name,
      description: params.description ?? '',
      type: params.type,
      status: 'pending',
      progress: 0,
      priority: params.priority ?? 'normal',
      timeout: params.timeout ?? this.config.defaultTimeout,
      tags: params.tags ?? [],
      metadata: params.metadata,
      action: params.action,
      subtaskIds: params.subtaskIds,
      loopConfig: params.loopConfig,
      condition: params.condition,
      retryConfig: params.retryConfig ?? {
        maxRetries: this.config.defaults.retryCount,
        retryDelay: this.config.defaults.retryDelay,
        backoffMultiplier: this.config.defaults.backoffMultiplier,
      },
      scheduleConfig: params.scheduleConfig,
      retryCount: 0,
      createdAt: now,
      updatedAt: now,
    }
  }

  async create(params: CreateTaskParams): Promise<CreateTaskResult> {
    const task = this.buildTask(params)
    const now = Math.floor(Date.now() / 1000)

    // 1. 写入 task_meta
    this.sqlite.run(
      `INSERT INTO task_meta (id, workspace_id, name, description, type, status, progress, priority, timeout,
        tags, metadata, action_json, subtask_ids, loop_config_json, condition_json,
        retry_config_json, schedule_config_json, retry_count, created_at, updated_at)
       VALUES (@id, @workspace_id, @name, @description, @type, 'pending', 0, @priority, @timeout,
        @tags, @metadata, @action_json, @subtask_ids, @loop_config_json, @condition_json,
        @retry_config_json, @schedule_config_json, 0, @created_at, @updated_at)`,
      {
        id: task.id,
        workspace_id: task.workspaceId,
        name: task.name,
        description: task.description,
        type: task.type,
        priority: task.priority,
        timeout: task.timeout ?? null,
        tags: JSON.stringify(task.tags),
        metadata: task.metadata ? JSON.stringify(task.metadata) : null,
        action_json: task.action ? JSON.stringify(task.action) : null,
        subtask_ids: task.subtaskIds ? JSON.stringify(task.subtaskIds) : null,
        loop_config_json: task.loopConfig ? JSON.stringify(task.loopConfig) : null,
        condition_json: task.condition ? JSON.stringify(task.condition) : null,
        retry_config_json: task.retryConfig ? JSON.stringify(task.retryConfig) : null,
        schedule_config_json: task.scheduleConfig ? JSON.stringify(task.scheduleConfig) : null,
        created_at: now,
        updated_at: now,
      },
    )

    // 2. 写入依赖
    if (params.dependencies && params.dependencies.length > 0) {
      for (const depId of params.dependencies) {
        this.sqlite.run(
          'INSERT INTO task_deps (task_id, depends_on_id) VALUES (@task_id, @depends_on_id)',
          { task_id: task.id, depends_on_id: depId },
        )
      }
    }

    // 3. 写入调度表
    if (params.scheduleConfig) {
      this.sqlite.run(
        `INSERT INTO task_schedule (task_id, schedule_mode, scheduled_at, cron_expression, trigger_event)
         VALUES (@task_id, @schedule_mode, @scheduled_at, @cron_expression, @trigger_event)`,
        {
          task_id: task.id,
          schedule_mode: params.scheduleConfig.mode,
          scheduled_at: params.scheduleConfig.delay
            ? now + params.scheduleConfig.delay
            : null,
          cron_expression: params.scheduleConfig.cron ?? null,
          trigger_event: params.scheduleConfig.event ?? null,
        },
      )
    }

    // 4. 加入调度队列
    const savedTask = this.getById(task.id) as Task
    await this.scheduler.enqueue(savedTask)

    this.logger.info(`任务创建成功: ${task.id} (${task.type})`)
    return { id: task.id, createdAt: now }
  }

  async batchCreate(params: BatchCreateParams): Promise<BatchCreateResult> {
    const ids: string[] = []
    for (const p of params.tasks) {
      const result = await this.create(p)
      ids.push(result.id)
    }
    return { ids, count: ids.length }
  }

  // ══════════════════════════════════════════════════════════════
  // 查询
  // ══════════════════════════════════════════════════════════════

  query(params: QueryParams): QueryResult {
    const conditions: string[] = []
    const bindings: Record<string, unknown> = {}

    if (params.id) {
      const task = this.getById(params.id)
      if (!task) return { tasks: [], total: 0, limit: 1, offset: 0 }
      return { tasks: [task], total: 1, limit: 1, offset: 0 }
    }

    if (params.workspaceId) {
      conditions.push('workspace_id = @workspace_id')
      bindings.workspace_id = params.workspaceId
    }
    if (params.status) {
      conditions.push('status = @status')
      bindings.status = params.status
    }
    if (params.priority) {
      conditions.push('priority = @priority')
      bindings.priority = params.priority
    }
    if (params.type) {
      conditions.push('type = @type')
      bindings.type = params.type
    }
    if (params.tags && params.tags.length > 0) {
      const tagConditions = params.tags.map((t, i) => {
        bindings[`tag_${i}`] = `%${t}%`
        return `tags LIKE @tag_${i}`
      })
      conditions.push(`(${tagConditions.join(' OR ')})`)
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    const sortField = params.sortBy ?? 'created_at'
    const sortDir = params.sortDir ?? 'desc'
    const orderClause = `ORDER BY
      CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 WHEN 'low' THEN 3 END,
      ${sortField} ${sortDir}`

    const limit = params.limit ?? 20
    const offset = params.offset ?? 0

    const countRow = this.sqlite.queryAll<{ count: number }>(
      `SELECT COUNT(*) as count FROM task_meta ${whereClause}`,
      bindings,
    )
    const total = countRow?.[0]?.count ?? 0

    const rows = this.sqlite.queryAll<TaskMetaRow>(
      `SELECT * FROM task_meta ${whereClause} ${orderClause} LIMIT @limit OFFSET @offset`,
      { ...bindings, limit, offset },
    )

    const tasks = rows.map((row) => rowToTask(row))
    return { tasks, total, limit, offset }
  }

  getById(id: string): Task | null {
    const rows = this.sqlite.queryAll<TaskMetaRow>(
      'SELECT * FROM task_meta WHERE id = @id',
      { id },
    )
    if (rows.length === 0) return null

    const deps = this.sqlite.queryAll<DepRow>(
      'SELECT depends_on_id FROM task_deps WHERE task_id = @task_id',
      { task_id: id },
    )

    return rowToTask(rows[0], deps.map(d => d.depends_on_id))
  }

  getProgress(id: string): TaskProgress {
    const task = this.getById(id)
    if (!task) throw new Error(`任务 ${id} 不存在`)

    return {
      progress: task.progress,
      status: task.status,
      startedAt: task.startedAt,
      completedAt: task.completedAt,
    }
  }

  list(params: ListParams): ListResult {
    return this.query(params as QueryParams)
  }

  // ══════════════════════════════════════════════════════════════
  // 更新
  // ══════════════════════════════════════════════════════════════

  async update(id: string, updates: UpdateTaskParams): Promise<void> {
    const existing = this.getById(id)
    if (!existing) {
      this.logger.warn(`更新失败：任务 ${id} 不存在`)
      return
    }

    const now = Math.floor(Date.now() / 1000)
    const sets: string[] = ['updated_at = @updated_at']
    const bindings: Record<string, unknown> = { id, updated_at: now }

    if (updates.name !== undefined) { sets.push('name = @name'); bindings.name = updates.name }
    if (updates.description !== undefined) { sets.push('description = @description'); bindings.description = updates.description }
    if (updates.priority !== undefined) { sets.push('priority = @priority'); bindings.priority = updates.priority }
    if (updates.timeout !== undefined) { sets.push('timeout = @timeout'); bindings.timeout = updates.timeout }
    if (updates.tags !== undefined) { sets.push('tags = @tags'); bindings.tags = JSON.stringify(updates.tags) }
    if (updates.metadata !== undefined) { sets.push('metadata = @metadata'); bindings.metadata = JSON.stringify(updates.metadata) }
    if (updates.action !== undefined) { sets.push('action_json = @action_json'); bindings.action_json = JSON.stringify(updates.action) }
    if (updates.retryConfig !== undefined) { sets.push('retry_config_json = @retry_config_json'); bindings.retry_config_json = JSON.stringify(updates.retryConfig) }

    this.sqlite.run(
      `UPDATE task_meta SET ${sets.join(', ')} WHERE id = @id`,
      bindings,
    )

    // 如果优先级变更，更新调度队列
    if (updates.priority) {
      const updated = this.getById(id)
      if (updated) {
        await this.scheduler.enqueue(updated)
      }
    }

    this.logger.info(`任务更新成功: ${id}`)
  }

  // ══════════════════════════════════════════════════════════════
  // 状态管理
  // ══════════════════════════════════════════════════════════════

  private setStatus(id: string, newStatus: TaskStatus, extra?: Partial<Record<string, unknown>>): void {
    const task = this.getById(id)
    if (!task) throw new Error(`任务 ${id} 不存在`)

    validateTransition(task.status, newStatus)

    const now = Math.floor(Date.now() / 1000)
    const sets: string[] = ['status = @status', 'updated_at = @updated_at']
    const bindings: Record<string, unknown> = { id, status: newStatus, updated_at: now }

    if (newStatus === 'running') {
      sets.push('started_at = @started_at')
      bindings.started_at = now
    }
    if (newStatus === 'completed' || newStatus === 'failed' || newStatus === 'cancelled') {
      sets.push('completed_at = @completed_at')
      bindings.completed_at = now
    }
    if (extra) {
      for (const [key, value] of Object.entries(extra)) {
        sets.push(`${key} = @${key}`)
        bindings[key] = value
      }
    }

    this.sqlite.run(
      `UPDATE task_meta SET ${sets.join(', ')} WHERE id = @id`,
      bindings,
    )
  }

  async pause(id: string): Promise<void> {
    this.setStatus(id, 'paused')
    await this.scheduler.dequeue(id)
    this.logger.info(`任务已暂停: ${id}`)
  }

  async resume(id: string): Promise<void> {
    this.setStatus(id, 'pending')
    const task = this.getById(id) as Task
    await this.scheduler.enqueue(task)
    this.logger.info(`任务已恢复: ${id}`)
  }

  async cancel(id: string, reason?: string): Promise<void> {
    this.setStatus(id, 'cancelled', reason ? { error: reason } : undefined)
    await this.scheduler.dequeue(id)
    this.timeoutManager.unregister(id)
    this.logger.info(`任务已取消: ${id}`)
  }

  async complete(id: string, result?: any): Promise<void> {
    this.setStatus(id, 'completed', {
      result_json: result ? JSON.stringify(result) : null,
      progress: 100,
    })
    this.timeoutManager.unregister(id)
    this.logger.info(`任务已完成: ${id}`)
  }

  async fail(id: string, error: string): Promise<void> {
    this.setStatus(id, 'failed', { error })
    this.timeoutManager.unregister(id)
    this.logger.info(`任务已失败: ${id}`)
  }

  // ══════════════════════════════════════════════════════════════
  // 调度/依赖管理
  // ══════════════════════════════════════════════════════════════

  async setPriority(id: string, priority: TaskPriority): Promise<void> {
    await this.update(id, { priority })
  }

  async addDependency(id: string, dependsOnId: string): Promise<void> {
    // 验证两个任务都存在
    const task = this.getById(id)
    const dep = this.getById(dependsOnId)
    if (!task) throw new Error(`任务 ${id} 不存在`)
    if (!dep) throw new Error(`依赖任务 ${dependsOnId} 不存在`)

    this.sqlite.run(
      'INSERT OR IGNORE INTO task_deps (task_id, depends_on_id) VALUES (@task_id, @depends_on_id)',
      { task_id: id, depends_on_id: dependsOnId },
    )
  }

  async removeDependency(id: string, dependsOnId: string): Promise<void> {
    this.sqlite.run(
      'DELETE FROM task_deps WHERE task_id = @task_id AND depends_on_id = @depends_on_id',
      { task_id: id, depends_on_id: dependsOnId },
    )
  }

  async schedule(id: string, config: ScheduleConfig): Promise<ScheduleResult> {
    const now = Math.floor(Date.now() / 1000)

    // 更新调度表
    this.sqlite.run(
      `INSERT OR REPLACE INTO task_schedule (task_id, schedule_mode, scheduled_at, cron_expression, trigger_event)
       VALUES (@task_id, @schedule_mode, @scheduled_at, @cron_expression, @trigger_event)`,
      {
        task_id: id,
        schedule_mode: config.mode,
        scheduled_at: config.delay ? now + config.delay : null,
        cron_expression: config.cron ?? null,
        trigger_event: config.event ?? null,
      },
    )

    // 更新 task_meta 中的 schedule_config
    this.sqlite.run(
      'UPDATE task_meta SET schedule_config_json = @config, updated_at = @updated_at WHERE id = @id',
      { id, config: JSON.stringify(config), updated_at: now },
    )

    this.logger.info(`任务调度更新: ${id} (${config.mode})`)
    return { id, scheduledAt: now }
  }

  async retry(id: string, force?: boolean): Promise<void> {
    const task = this.getById(id)
    if (!task) throw new Error(`任务 ${id} 不存在`)

    if (!force && task.status !== 'failed') {
      throw new Error(`只有失败的任务可以重试，当前状态: ${task.status}`)
    }

    // 重置状态
    const now = Math.floor(Date.now() / 1000)
    this.sqlite.run(
      `UPDATE task_meta SET status = 'pending', progress = 0, error = NULL, result_json = NULL,
        retry_count = retry_count + 1, updated_at = @updated_at WHERE id = @id`,
      { id, updated_at: now },
    )

    // 重新加入调度队列
    const updated = this.getById(id) as Task
    await this.scheduler.enqueue(updated)
    this.logger.info(`任务重试: ${id} (第 ${updated.retryCount} 次)`)
  }

  // ══════════════════════════════════════════════════════════════
  // 执行
  // ══════════════════════════════════════════════════════════════

  private async executeTaskWithTimeout(task: Task): Promise<void> {
    // 注册超时
    const timeout = task.timeout ?? this.config.defaultTimeout
    if (timeout > 0) {
      this.timeoutManager.register(task.id, timeout, async () => {
        this.logger.warn(`任务超时: ${task.id}`)
        await this.fail(task.id, 'timeout')
        this.scheduler.runningCount--
      })
    }

    // 构建执行上下文
    const context: ExecutionContext = {
      workspaceId: task.workspaceId,
      callTool: async (toolName, params) => {
        // 由外部注入实际工具调用能力
        this.logger.info(`执行工具调用: ${toolName}`)
        return { success: true, data: { toolName, params } }
      },
      getSubTask: async (id) => this.getById(id),
      updateProgress: async (taskId, progress) => {
        this.sqlite.run(
          'UPDATE task_meta SET progress = @progress, updated_at = @updated_at WHERE id = @id',
          { id: taskId, progress, updated_at: Math.floor(Date.now() / 1000) },
        )
      },
      log: async (taskId, message) => {
        this.logger.info(`[Task ${taskId}] ${message}`)
      },
      abortSignal: this.timeoutManager.getAbortSignal(task.id),
    }

    try {
      const result = await this.executor.execute(task, context)
      if (result.success) {
        await this.complete(task.id, result.data)
      } else {
        await this.handleFailure(task, result.error ?? '未知错误')
      }
    } catch (err) {
      await this.handleFailure(task, (err as Error).message)
    } finally {
      this.scheduler.runningCount--
    }
  }

  private async handleFailure(task: Task, error: string): Promise<void> {
    const retryConfig = task.retryConfig ?? {
      maxRetries: this.config.defaults.retryCount,
      retryDelay: this.config.defaults.retryDelay,
      backoffMultiplier: this.config.defaults.backoffMultiplier,
    }

    if (task.retryCount < retryConfig.maxRetries) {
      // 指数退避 + 优先级提升
      const delay = retryConfig.retryDelay * Math.pow(retryConfig.backoffMultiplier ?? 2.0, task.retryCount)
      await this.fail(task.id, `${error} (将重试 ${task.retryCount + 1}/${retryConfig.maxRetries})`)

      setTimeout(async () => {
        // 优先级提升一级
        const priorityOrder: TaskPriority[] = ['low', 'normal', 'high', 'critical']
        const currentIdx = priorityOrder.indexOf(task.priority)
        const boostedPriority = currentIdx < 3 ? priorityOrder[currentIdx + 1] : 'critical'
        task.priority = boostedPriority

        this.logger.info(`任务重试: ${task.id} (第 ${task.retryCount + 1} 次, 延迟 ${delay}s, 优先级 ${boostedPriority})`)
        await this.retry(task.id, true)
      }, delay * 1000)
    } else {
      await this.fail(task.id, error)
      this.logger.info(`任务重试耗尽: ${task.id} (已重试 ${task.retryCount} 次)`)
    }
  }

  // ══════════════════════════════════════════════════════════════
  // 任务分解
  // ══════════════════════════════════════════════════════════════

  async decompose(params: DecomposeParams): Promise<DecomposeResult> {
    // LLM 辅助分解的默认实现
    // 生成一个简单的子任务列表
    const subtasks: DecomposedSubTask[] = [
      {
        name: `${params.taskDescription} - 准备`,
        description: `为 "${params.taskDescription}" 做准备`,
        type: 'simple',
        tags: ['decomposed'],
      },
      {
        name: `${params.taskDescription} - 执行`,
        description: `执行 "${params.taskDescription}"`,
        type: 'simple',
        dependencies: ['__prev__'],
        tags: ['decomposed'],
      },
      {
        name: `${params.taskDescription} - 收尾`,
        description: `完成 "${params.taskDescription}" 的收尾工作`,
        type: 'simple',
        dependencies: ['__prev__'],
        tags: ['decomposed'],
      },
    ]

    return {
      subtasks,
      summary: `将 "${params.taskDescription}" 分解为 ${subtasks.length} 个子任务`,
    }
  }

  // ══════════════════════════════════════════════════════════════
  // 统计
  // ══════════════════════════════════════════════════════════════

  stats(): TaskStats {
    const totalRow = this.sqlite.queryAll<{ count: number }>(
      'SELECT COUNT(*) as count FROM task_meta',
    )
    const total = totalRow?.[0]?.count ?? 0

    const byStatusRows = this.sqlite.queryAll<{ status: string; count: number }>(
      'SELECT status, COUNT(*) as count FROM task_meta GROUP BY status',
    )
    const byStatus: Partial<Record<TaskStatus, number>> = {}
    for (const r of byStatusRows) {
      byStatus[r.status as TaskStatus] = r.count
    }

    const byTypeRows = this.sqlite.queryAll<{ type: string; count: number }>(
      'SELECT type, COUNT(*) as count FROM task_meta GROUP BY type',
    )
    const byType: Partial<Record<TaskType, number>> = {}
    for (const r of byTypeRows) {
      byType[r.type as TaskType] = r.count
    }

    const byPriorityRows = this.sqlite.queryAll<{ priority: string; count: number }>(
      'SELECT priority, COUNT(*) as count FROM task_meta GROUP BY priority',
    )
    const byPriority: Partial<Record<TaskPriority, number>> = {}
    for (const r of byPriorityRows) {
      byPriority[r.priority as TaskPriority] = r.count
    }

    const completed = byStatus.completed ?? 0
    const completionRate = total > 0 ? Math.round((completed / total) * 1000) / 10 : 0

    // 平均耗时
    const durationRow = this.sqlite.queryAll<{ avg: number | null }>(
      "SELECT AVG(completed_at - started_at) as avg FROM task_meta WHERE status = 'completed' AND started_at IS NOT NULL AND completed_at IS NOT NULL",
    )
    const averageDurationMs = (durationRow?.[0]?.avg ?? 0) * 1000

    // 总耗时
    const totalDurationRow = this.sqlite.queryAll<{ sum: number | null }>(
      "SELECT SUM(completed_at - started_at) as sum FROM task_meta WHERE status = 'completed' AND started_at IS NOT NULL AND completed_at IS NOT NULL",
    )
    const totalDurationMs = (totalDurationRow?.[0]?.sum ?? 0) * 1000

    return {
      total,
      byStatus,
      byType,
      byPriority,
      completionRate,
      averageDurationMs,
      totalDurationMs,
    }
  }

  // ══════════════════════════════════════════════════════════════
  // 清理
  // ══════════════════════════════════════════════════════════════

  async cleanup(options?: CleanupOptions): Promise<CleanupResult> {
    const keepRecent = options?.keepRecent ?? this.config.cleanupKeepRecent
    const olderThan = options?.olderThan ?? Math.floor(Date.now() / 1000) - 86400 * 7 // 默认 7 天
    const statuses = options?.statuses ?? ['completed', 'failed', 'cancelled']
    const details: CleanupResult['details'] = []

    const statusList = statuses.map(s => `'${s}'`).join(',')
    // 先获取总数
    const totalRow = this.sqlite.queryAll<{ count: number }>(
      `SELECT COUNT(*) as count FROM task_meta WHERE status IN (${statusList}) AND completed_at < @older_than`,
      { older_than: olderThan },
    )
    const total = totalRow?.[0]?.count ?? 0

    // 如果总数 <= keepRecent，不清理
    if (total <= keepRecent) {
      return { removed: 0, kept: total, details: [] }
    }

    // 获取需要删除的 ID
    const toRemove = this.sqlite.queryAll<TaskMetaRow>(
      `SELECT id FROM task_meta WHERE status IN (${statusList}) AND completed_at < @older_than ORDER BY completed_at ASC`,
      { older_than: olderThan },
    )

    // 保留最近 N 条
    const removeIds = toRemove.slice(0, toRemove.length - keepRecent)

    for (const row of removeIds) {
      this.sqlite.run('DELETE FROM task_meta WHERE id = @id', { id: row.id })
      details.push({ id: row.id, reason: 'cleanup' })
    }

    this.logger.info(`清理完成: ${details.length} 条任务被删除`)
    return {
      removed: details.length,
      kept: total - details.length,
      details,
    }
  }

  // ══════════════════════════════════════════════════════════════
  // 导出/导入
  // ══════════════════════════════════════════════════════════════

  async export(options?: ExportOptions): Promise<string> {
    const conditions: string[] = []
    const bindings: Record<string, unknown> = {}

    if (options?.type) { conditions.push('type = @type'); bindings.type = options.type }
    if (options?.status) { conditions.push('status = @status'); bindings.status = options.status }
    if (options?.workspaceId) { conditions.push('workspace_id = @workspace_id'); bindings.workspace_id = options.workspaceId }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    const rows = this.sqlite.queryAll<TaskMetaRow>(
      `SELECT * FROM task_meta ${whereClause}`,
      bindings,
    )

    const data = rows.map((row) => rowToTask(row))
    return JSON.stringify(data, null, 2)
  }

  async import(json: string): Promise<ImportResult> {
    const errors: Array<{ index: number; reason: string }> = []
    let imported = 0
    let skipped = 0

    let records: Array<Record<string, any>>
    try {
      records = JSON.parse(json) as Array<Record<string, any>>
      if (!Array.isArray(records)) throw new Error('Not an array')
    } catch {
      return { imported: 0, skipped: 0, errors: [{ index: 0, reason: '无法解析 JSON 格式' }] }
    }

    for (let i = 0; i < records.length; i++) {
      try {
        const record = records[i]
        if (!record.name || !record.type) {
          skipped++
          errors.push({ index: i, reason: '缺少 name 或 type 字段' })
          continue
        }

        const now = Math.floor(Date.now() / 1000)
        this.sqlite.run(
          `INSERT INTO task_meta (id, workspace_id, name, description, type, status, progress, priority, timeout,
            tags, metadata, action_json, subtask_ids, loop_config_json, condition_json,
            retry_config_json, schedule_config_json, retry_count, created_at, updated_at)
           VALUES (@id, @workspace_id, @name, @description, @type, @status, @progress, @priority, @timeout,
            @tags, @metadata, @action_json, @subtask_ids, @loop_config_json, @condition_json,
            @retry_config_json, @schedule_config_json, @retry_count, @created_at, @updated_at)`,
          {
            id: record.id ?? randomUUID(),
            workspace_id: record.workspaceId ?? 'default',
            name: record.name,
            description: record.description ?? '',
            type: record.type,
            status: record.status ?? 'pending',
            progress: record.progress ?? 0,
            priority: record.priority ?? 'normal',
            timeout: record.timeout ?? null,
            tags: JSON.stringify(record.tags ?? []),
            metadata: record.metadata ? JSON.stringify(record.metadata) : null,
            action_json: record.action ? JSON.stringify(record.action) : null,
            subtask_ids: record.subtaskIds ? JSON.stringify(record.subtaskIds) : null,
            loop_config_json: record.loopConfig ? JSON.stringify(record.loopConfig) : null,
            condition_json: record.condition ? JSON.stringify(record.condition) : null,
            retry_config_json: record.retryConfig ? JSON.stringify(record.retryConfig) : null,
            schedule_config_json: record.scheduleConfig ? JSON.stringify(record.scheduleConfig) : null,
            retry_count: record.retryCount ?? 0,
            created_at: record.createdAt ?? now,
            updated_at: now,
          },
        )
        imported++
      } catch (err) {
        skipped++
        errors.push({ index: i, reason: `导入失败: ${(err as Error).message}` })
      }
    }

    this.logger.info(`导入完成: ${imported} 条成功, ${skipped} 条跳过`)
    return { imported, skipped, errors }
  }

  // ══════════════════════════════════════════════════════════════
  // 生命周期
  // ══════════════════════════════════════════════════════════════

  async close(): Promise<void> {
    this.scheduler.stop()
    this.timeoutManager.clearAll()
    this.logger.info('TaskManager 已关闭')
  }
}