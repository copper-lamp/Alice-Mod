/**
 * 任务工具单元测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { TaskManager } from '../../src/main/task/task-manager'
import { SQLiteStore } from '../../src/main/memory/sqlite-store'
import { taskCreate, taskBatchCreate } from '../../src/main/task/tools/task_create'
import { taskQuery, taskGetById, taskGetProgress, taskList } from '../../src/main/task/tools/task_query'
import { taskUpdate } from '../../src/main/task/tools/task_update'
import { taskControl } from '../../src/main/task/tools/task_control'
import { taskDecompose } from '../../src/main/task/tools/task_decompose'
import { taskStats, taskCleanup, taskExport, taskImport, taskSetPriority, taskAddDependency } from '../../src/main/task/tools/task_manage'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('Task Tools', () => {
  let dbPath: string
  let sqlite: SQLiteStore
  let manager: TaskManager

  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), 'task-tools-test-'))
    dbPath = join(dir, 'test.db')
    sqlite = new SQLiteStore(dbPath)
    manager = new TaskManager({}, { sqlite })
  })

  afterEach(() => {
    manager.close()
    sqlite.close()
    try { rmSync(dbPath, { force: true }) } catch { /* ignore */ }
  })

  describe('task_create', () => {
    it('should create a simple task', async () => {
      const result = await taskCreate(manager, {
        name: '挖钻石',
        type: 'simple',
        action: { toolName: 'mine_block', parameters: { target: 'diamond_ore' } },
      })
      expect(result.success).toBe(true)
      expect(result.data).toBeTruthy()
      expect(result.data!.id).toBeTruthy()
    })

    it('should create with dependencies', async () => {
      // 先创建依赖任务
      const dep = await taskCreate(manager, { name: '准备工具', type: 'simple', action: { toolName: 'craft', parameters: {} } })

      const result = await taskCreate(manager, {
        name: '挖钻石',
        type: 'simple',
        action: { toolName: 'mine_block', parameters: {} },
        dependencies: [dep.data!.id],
      })
      expect(result.success).toBe(true)
    })
  })

  describe('task_batch_create', () => {
    it('should batch create tasks', async () => {
      const result = await taskBatchCreate(manager, {
        tasks: [
          { name: '任务1', type: 'simple', action: { toolName: 'test', parameters: {} } },
          { name: '任务2', type: 'simple', action: { toolName: 'test', parameters: {} } },
        ],
      })
      expect(result.success).toBe(true)
      expect(result.data!.count).toBe(2)
    })
  })

  describe('task_query', () => {
    it('should query tasks', async () => {
      await taskCreate(manager, { name: '任务1', type: 'simple', action: { toolName: 'test', parameters: {} } })

      const result = await taskQuery(manager, {})
      expect(result.success).toBe(true)
      expect(result.data!.total).toBeGreaterThanOrEqual(1)
    })
  })

  describe('task_get_by_id', () => {
    it('should get task by id', async () => {
      const created = await taskCreate(manager, { name: '任务1', type: 'simple', action: { toolName: 'test', parameters: {} } })

      const result = await taskGetById(manager, { task_id: created.data!.id })
      expect(result.success).toBe(true)
      expect(result.data!.name).toBe('任务1')
    })
  })

  describe('task_get_progress', () => {
    it('should get task progress', async () => {
      const created = await taskCreate(manager, { name: '任务1', type: 'simple', action: { toolName: 'test', parameters: {} } })

      const result = await taskGetProgress(manager, { task_id: created.data!.id })
      expect(result.success).toBe(true)
      expect(result.data!.status).toBe('pending')
      expect(result.data!.progress).toBe(0)
    })
  })

  describe('task_list', () => {
    it('should list tasks', async () => {
      await taskCreate(manager, { name: '任务1', type: 'simple', action: { toolName: 'test', parameters: {} } })

      const result = await taskList(manager, {})
      expect(result.success).toBe(true)
      expect(result.data!.tasks.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('task_update', () => {
    it('should update task', async () => {
      const created = await taskCreate(manager, { name: '任务1', type: 'simple', action: { toolName: 'test', parameters: {} } })

      const result = await taskUpdate(manager, { task_id: created.data!.id, priority: 'high' })
      expect(result.success).toBe(true)
    })
  })

  describe('task_control', () => {
    it('should pause and resume task', async () => {
      const created = await taskCreate(manager, { name: '任务1', type: 'simple', action: { toolName: 'test', parameters: {} } })
      manager.sqlite.run('UPDATE task_meta SET status = @status WHERE id = @id', { status: 'running', id: created.data!.id })

      const pauseResult = await taskControl(manager, { task_id: created.data!.id, action: 'pause' })
      expect(pauseResult.success).toBe(true)

      const resumeResult = await taskControl(manager, { task_id: created.data!.id, action: 'resume' })
      expect(resumeResult.success).toBe(true)
    })
  })

  describe('task_decompose', () => {
    it('should decompose a task', async () => {
      const result = await taskDecompose(manager, { task_description: '建造一个木屋' })
      expect(result.success).toBe(true)
      expect(result.data!.subtasks.length).toBeGreaterThan(0)
    })
  })

  describe('task_stats', () => {
    it('should return stats', async () => {
      await taskCreate(manager, { name: '任务1', type: 'simple', action: { toolName: 'test', parameters: {} } })

      const result = await taskStats(manager)
      expect(result.success).toBe(true)
      expect(result.data!.total).toBeGreaterThanOrEqual(1)
    })
  })

  describe('task_cleanup', () => {
    it('should cleanup tasks', async () => {
      const created = await taskCreate(manager, { name: '任务1', type: 'simple', action: { toolName: 'test', parameters: {} } })
      manager.sqlite.run(
        "UPDATE task_meta SET status = 'completed', completed_at = @completed_at WHERE id = @id",
        { id: created.data!.id, completed_at: Math.floor(Date.now() / 1000) - 86400 * 14 },
      )

      const result = await taskCleanup(manager, { keep_recent: 0, older_than: Math.floor(Date.now() / 1000) - 86400 * 7 })
      expect(result.success).toBe(true)
    })
  })

  describe('task_export/import', () => {
    it('should export tasks', async () => {
      await taskCreate(manager, { name: '任务1', type: 'simple', action: { toolName: 'test', parameters: {} } })

      const result = await taskExport(manager, {})
      expect(result.success).toBe(true)
      const parsed = JSON.parse(result.data!)
      expect(parsed.length).toBeGreaterThanOrEqual(1)
    })

    it('should import tasks', async () => {
      const json = JSON.stringify([{ name: '导入任务', type: 'simple', action: { toolName: 'test', parameters: {} } }])
      const result = await taskImport(manager, { json })
      expect(result.success).toBe(true)
      expect(result.data!.imported).toBe(1)
    })
  })

  describe('task_set_priority', () => {
    it('should set priority', async () => {
      const created = await taskCreate(manager, { name: '任务1', type: 'simple', action: { toolName: 'test', parameters: {} } })

      const result = await taskSetPriority(manager, { task_id: created.data!.id, priority: 'critical' })
      expect(result.success).toBe(true)
    })
  })

  describe('task_add_dependency', () => {
    it('should add dependency', async () => {
      const taskA = await taskCreate(manager, { name: '任务A', type: 'simple', action: { toolName: 'test', parameters: {} } })
      const taskB = await taskCreate(manager, { name: '任务B', type: 'simple', action: { toolName: 'test', parameters: {} } })

      const result = await taskAddDependency(manager, { task_id: taskB.data!.id, depends_on_id: taskA.data!.id })
      expect(result.success).toBe(true)
    })
  })
})