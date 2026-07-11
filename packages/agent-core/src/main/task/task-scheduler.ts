/**
 * TaskScheduler — 任务调度器
 *
 * 优先级队列调度器，支持依赖解析、并发控制（max 3）、事件驱动。
 * 每 1s 轮询一次队列，检查可执行的任务。
 */

import { EventEmitter } from 'node:events'
import type { ISQLiteStore } from '../memory/sqlite-store'
import type {
  Task, TaskPriority, TaskStatus,
  SchedulerEvent, SchedulerEventHandler, QueueStatus,
} from './types'

// ════════════════════════════════════════════════════════════════
// 类型
// ════════════════════════════════════════════════════════════════

export interface TaskSchedulerEvents {
  task_started: { taskId: string; task: Task }
  task_completed: { taskId: string; task: Task; result?: any }
  task_failed: { taskId: string; task: Task; error?: string }
  task_dependency_met: { taskId: string; task: Task }
  queue_empty: {}
}

interface SchedulerConfig {
  maxConcurrent: number
  pollIntervalMs: number
}

interface SchedulerDeps {
  sqlite: ISQLiteStore
  executeTask: (task: Task) => Promise<void>
  logger: { warn: (msg: string, err?: unknown) => void; info: (msg: string) => void; error: (msg: string, err?: unknown) => void }
}

// ════════════════════════════════════════════════════════════════
// TaskScheduler 类
// ════════════════════════════════════════════════════════════════

export class TaskScheduler {
  private running = false
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private queue: Task[] = []
  public runningCount = 0
  private maxConcurrent: number
  private pollIntervalMs: number
  private sqlite: ISQLiteStore
  private executeTask: (task: Task) => Promise<void>
  private eventEmitter = new EventEmitter()
  private logger: SchedulerDeps['logger']

  // 优先级顺序
  private static readonly PRIORITY_ORDER: Record<TaskPriority, number> = {
    critical: 0,
    high: 1,
    normal: 2,
    low: 3,
  }

  constructor(config: SchedulerConfig, deps: SchedulerDeps) {
    this.maxConcurrent = config.maxConcurrent
    this.pollIntervalMs = config.pollIntervalMs
    this.sqlite = deps.sqlite
    this.executeTask = deps.executeTask
    this.logger = deps.logger
  }

  // ══════════════════════════════════════════════════════════════
  // 启停
  // ══════════════════════════════════════════════════════════════

  start(): void {
    if (this.running) return
    this.running = true

    // 启动时重新加载所有 pending 任务
    this.reloadPendingTasks()

    this.pollTimer = setInterval(() => {
      this.scheduleCycle()
    }, this.pollIntervalMs)

    this.logger.info('TaskScheduler 已启动')
  }

  stop(): void {
    this.running = false
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
    this.logger.info('TaskScheduler 已停止')
  }

  /**
   * 启动时从 SQLite 重新加载所有 pending 任务
   */
  private reloadPendingTasks(): void {
    try {
      const rows = this.sqlite.queryAll<{
        id: string; workspace_id: string; name: string; type: string;
        status: string; priority: string; created_at: number; progress: number;
      }>(
        "SELECT id, workspace_id, name, type, status, priority, created_at, progress FROM task_meta WHERE status = 'pending' ORDER BY CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 WHEN 'low' THEN 3 END, created_at ASC",
      )

      for (const row of rows) {
        this.queue.push({
          id: row.id,
          workspaceId: row.workspace_id,
          name: row.name,
          description: '',
          type: row.type as any,
          status: 'pending' as any,
          progress: row.progress,
          priority: row.priority as TaskPriority,
          tags: [],
          retryCount: 0,
          createdAt: row.created_at,
          updatedAt: row.created_at,
        } as Task)
      }

      if (rows.length > 0) {
        this.logger.info(`重新加载了 ${rows.length} 个待处理任务`)
      }
    } catch (err) {
      this.logger.warn('重新加载待处理任务失败', err)
    }
  }

  // ══════════════════════════════════════════════════════════════
  // 队列管理
  // ══════════════════════════════════════════════════════════════

  async enqueue(task: Task): Promise<void> {
    // 只接受 pending 或 running 状态的任务
    if (task.status !== 'pending' && task.status !== 'running') return

    // 如果已经在队列中，更新
    const existingIdx = this.queue.findIndex(t => t.id === task.id)
    if (existingIdx >= 0) {
      this.queue[existingIdx] = task
      return
    }

    // 直接加入队列
    this.queue.push(task)
  }

  async dequeue(taskId: string): Promise<void> {
    this.queue = this.queue.filter(t => t.id !== taskId)
  }

  getQueueStatus(): QueueStatus {
    return {
      pendingCount: this.queue.length,
      runningCount: this.runningCount,
      maxConcurrent: this.maxConcurrent,
      queue: this.queue.map(t => ({
        id: t.id,
        priority: t.priority,
        waitingFor: (t as any).waitingFor as string[] | undefined,
      })),
    }
  }

  // ══════════════════════════════════════════════════════════════
  // 事件
  // ══════════════════════════════════════════════════════════════

  on<E extends SchedulerEvent>(event: E, handler: SchedulerEventHandler): void {
    this.eventEmitter.on(event, handler)
  }

  off<E extends SchedulerEvent>(event: E, handler: SchedulerEventHandler): void {
    this.eventEmitter.off(event, handler)
  }

  private emit(event: SchedulerEvent, payload: any): void {
    this.eventEmitter.emit(event, payload)
  }

  // ══════════════════════════════════════════════════════════════
  // 调度循环
  // ══════════════════════════════════════════════════════════════

  private async scheduleCycle(): Promise<void> {
    if (!this.running) return
    if (this.runningCount >= this.maxConcurrent) return
    if (this.queue.length === 0) {
      this.emit('queue_empty', {})
      return
    }

    // 按优先级排序
    this.sortByPriority()

    const toExecute: Task[] = []

    for (const task of this.queue) {
      if (this.runningCount >= this.maxConcurrent) break
      if (task.status !== 'pending') continue

      // 检查依赖
      if (!this.checkDependencies(task)) {
        continue
      }

      // 从队列移除并执行
      this.queue = this.queue.filter(t => t.id !== task.id)
      this.runningCount++
      toExecute.push(task)

      // 更新状态为 running
      this.updateTaskStatus(task.id, 'running')
    }

    // 异步执行（不阻塞调度循环）
    for (const task of toExecute) {
      this.emit('task_started', { taskId: task.id, task })
      this.executeTask(task).catch((err) => {
        this.logger.error(`任务执行异常: ${task.id}`, err)
      })
    }
  }

  private sortByPriority(): void {
    this.queue.sort((a, b) => {
      const pa = TaskScheduler.PRIORITY_ORDER[a.priority] ?? 2
      const pb = TaskScheduler.PRIORITY_ORDER[b.priority] ?? 2
      if (pa !== pb) return pa - pb
      return a.createdAt - b.createdAt // FIFO
    })
  }

  /**
   * 检查任务依赖是否全部满足
   */
  private checkDependencies(task: Task): boolean {
    try {
      const deps = this.sqlite.queryAll<{ depends_on_id: string; status: string }>(
        `SELECT td.depends_on_id, tm.status
         FROM task_deps td
         JOIN task_meta tm ON td.depends_on_id = tm.id
         WHERE td.task_id = @task_id`,
        { task_id: task.id },
      )

      const unsatisfied = deps.filter(d => d.status !== 'completed')
      if (unsatisfied.length > 0) {
        (task as any).waitingFor = unsatisfied.map(d => d.depends_on_id)
        return false
      }

      return true
    } catch {
      // 没有依赖
      return true
    }
  }

  private updateTaskStatus(taskId: string, status: TaskStatus): void {
    const now = Math.floor(Date.now() / 1000)
    try {
      this.sqlite.run(
        'UPDATE task_meta SET status = @status, started_at = COALESCE(started_at, @now), updated_at = @now WHERE id = @id',
        { id: taskId, status, now },
      )
    } catch (err) {
      this.logger.warn(`更新任务状态失败: ${taskId}`, err)
    }
  }
}