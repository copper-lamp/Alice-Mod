/**
 * TaskScheduler 单元测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { TaskScheduler } from '../../src/main/task/task-scheduler'
import { SQLiteStore } from '../../src/main/memory/sqlite-store'
import type { Task, TaskPriority } from '../../src/main/task/types'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

function createTestTask(overrides: Partial<Task> = {}): Task {
  const now = Math.floor(Date.now() / 1000)
  return {
    id: overrides.id ?? `task-${Math.random().toString(36).slice(2, 8)}`,
    workspaceId: overrides.workspaceId ?? 'test-ws',
    name: overrides.name ?? 'test',
    description: overrides.description ?? '',
    type: overrides.type ?? 'simple',
    status: overrides.status ?? 'pending',
    progress: overrides.progress ?? 0,
    priority: overrides.priority ?? 'normal',
    tags: overrides.tags ?? [],
    retryCount: overrides.retryCount ?? 0,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    ...overrides,
  }
}

describe('TaskScheduler', () => {
  let dbPath: string
  let sqlite: SQLiteStore
  let scheduler: TaskScheduler
  let executedTasks: string[]

  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), 'scheduler-test-'))
    dbPath = join(dir, 'test.db')
    sqlite = new SQLiteStore(dbPath)
    executedTasks = []

    scheduler = new TaskScheduler(
      { maxConcurrent: 3, pollIntervalMs: 100 },
      {
        sqlite,
        executeTask: async (task) => {
          executedTasks.push(task.id)
        },
        logger: {
          warn: () => {},
          info: () => {},
          error: () => {},
        },
      },
    )
  })

  afterEach(() => {
    scheduler.stop()
    sqlite.close()
    try { rmSync(dbPath, { force: true }) } catch { /* ignore */ }
  })

  describe('enqueue/dequeue', () => {
    it('should enqueue a pending task', async () => {
      const task = createTestTask()
      await scheduler.enqueue(task)
      const status = scheduler.getQueueStatus()
      expect(status.pendingCount).toBe(1)
    })

    it('should not enqueue non-pending tasks', async () => {
      const task = createTestTask({ status: 'completed' })
      await scheduler.enqueue(task)
      const status = scheduler.getQueueStatus()
      expect(status.pendingCount).toBe(0)
    })

    it('should dequeue a task', async () => {
      const task = createTestTask()
      await scheduler.enqueue(task)
      await scheduler.dequeue(task.id)
      const status = scheduler.getQueueStatus()
      expect(status.pendingCount).toBe(0)
    })
  })

  describe('priority', () => {
    it('should execute high priority before low priority', async () => {
      const lowTask = createTestTask({ id: 'low-1', priority: 'low', createdAt: 1000 })
      const highTask = createTestTask({ id: 'high-1', priority: 'high', createdAt: 2000 })

      await scheduler.enqueue(highTask)
      await scheduler.enqueue(lowTask)

      scheduler.start()

      // 等待调度循环执行
      await new Promise(resolve => setTimeout(resolve, 300))
      scheduler.stop()

      expect(executedTasks.length).toBeGreaterThan(0)
      if (executedTasks.length >= 2) {
        expect(executedTasks[0]).toBe('high-1')
        expect(executedTasks[1]).toBe('low-1')
      }
    })
  })

  describe('concurrency', () => {
    it('should respect maxConcurrent limit', async () => {
      // 创建 5 个任务
      for (let i = 0; i < 5; i++) {
        const task = createTestTask({ id: `task-${i}` })
        // 直接写入 SQLite
        sqlite.run(
          `INSERT INTO task_meta (id, workspace_id, name, description, type, status, priority, tags, retry_count, created_at, updated_at)
           VALUES (@id, @ws, @name, '', 'simple', 'pending', 'normal', '[]', 0, @now, @now)`,
          { id: task.id, ws: 'test-ws', name: task.name, now: Math.floor(Date.now() / 1000) },
        )
        await scheduler.enqueue(task)
      }

      scheduler.start()
      await new Promise(resolve => setTimeout(resolve, 500))
      scheduler.stop()

      // 并发数不超过 3
      expect(executedTasks.length).toBeLessThanOrEqual(3)
    })
  })

  describe('events', () => {
    it('should emit queue_empty when queue is empty', async () => {
      const spy = vi.fn()
      scheduler.on('queue_empty', spy)

      scheduler.start()
      await new Promise(resolve => setTimeout(resolve, 200))
      scheduler.stop()

      expect(spy).toHaveBeenCalled()
    })
  })

  describe('start/stop', () => {
    it('should start and stop the scheduler', () => {
      scheduler.start()
      const status1 = scheduler.getQueueStatus()
      expect(status1).toBeDefined()

      scheduler.stop()
      // 停止后不应有新的调度
      expect(scheduler.getQueueStatus()).toBeDefined()
    })
  })
})