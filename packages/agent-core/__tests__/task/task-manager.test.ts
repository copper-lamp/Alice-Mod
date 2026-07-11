/**
 * TaskManager 单元测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { TaskManager } from '../../src/main/task/task-manager'
import { SQLiteStore } from '../../src/main/memory/sqlite-store'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('TaskManager', () => {
  let dbPath: string
  let sqlite: SQLiteStore
  let manager: TaskManager

  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), 'task-test-'))
    dbPath = join(dir, 'test.db')
    sqlite = new SQLiteStore(dbPath)
    manager = new TaskManager({}, { sqlite })
  })

  afterEach(() => {
    manager.close()
    sqlite.close()
    try { rmSync(dbPath, { force: true }) } catch { /* ignore */ }
  })

  describe('create', () => {
    it('should create a simple task', async () => {
      const result = await manager.create({
        workspaceId: 'test-ws',
        name: '挖钻石',
        description: '挖 10 个钻石',
        type: 'simple',
        action: { toolName: 'mine_block', parameters: { target: 'diamond_ore' } },
      })
      expect(result.id).toBeTruthy()
      expect(result.createdAt).toBeGreaterThan(0)

      const task = manager.getById(result.id)
      expect(task).not.toBeNull()
      expect(task!.name).toBe('挖钻石')
      expect(task!.type).toBe('simple')
      expect(task!.status).toBe('pending')
      expect(task!.action?.toolName).toBe('mine_block')
    })

    it('should create a composite task', async () => {
      const result = await manager.create({
        workspaceId: 'test-ws',
        name: '建造房屋',
        type: 'composite',
        subtaskIds: ['sub1', 'sub2', 'sub3'],
      })
      const task = manager.getById(result.id)
      expect(task!.type).toBe('composite')
      expect(task!.subtaskIds).toEqual(['sub1', 'sub2', 'sub3'])
    })

    it('should create a loop task', async () => {
      const result = await manager.create({
        workspaceId: 'test-ws',
        name: '巡逻',
        type: 'loop',
        action: { toolName: 'move_to', parameters: { x: 100, z: 100 } },
        loopConfig: { mode: 'count', count: 5, maxIterations: 100 },
      })
      const task = manager.getById(result.id)
      expect(task!.type).toBe('loop')
      expect(task!.loopConfig?.mode).toBe('count')
      expect(task!.loopConfig?.count).toBe(5)
    })

    it('should create a conditional task', async () => {
      const result = await manager.create({
        workspaceId: 'test-ws',
        name: '饥饿时吃东西',
        type: 'conditional',
        action: { toolName: 'eat', parameters: { food: 'apple' } },
        condition: { type: 'state', value: { toolName: 'get_hunger', check: 'result < 10' } },
      })
      const task = manager.getById(result.id)
      expect(task!.type).toBe('conditional')
      expect(task!.condition?.type).toBe('state')
    })

    it('should batch create tasks', async () => {
      const result = await manager.batchCreate({
        tasks: [
          { workspaceId: 'test-ws', name: '任务1', type: 'simple', action: { toolName: 'test', parameters: {} } },
          { workspaceId: 'test-ws', name: '任务2', type: 'simple', action: { toolName: 'test', parameters: {} } },
          { workspaceId: 'test-ws', name: '任务3', type: 'simple', action: { toolName: 'test', parameters: {} } },
        ],
      })
      expect(result.count).toBe(3)
      expect(result.ids.length).toBe(3)
    })
  })

  describe('query', () => {
    it('should query by status', async () => {
      await manager.create({ workspaceId: 'test-ws', name: '任务1', type: 'simple', action: { toolName: 'test', parameters: {} } })
      await manager.create({ workspaceId: 'test-ws', name: '任务2', type: 'simple', action: { toolName: 'test', parameters: {} } })

      const result = manager.query({ status: 'pending' })
      expect(result.total).toBe(2)
      expect(result.tasks.length).toBe(2)
    })

    it('should query by id', async () => {
      const created = await manager.create({ workspaceId: 'test-ws', name: '任务1', type: 'simple', action: { toolName: 'test', parameters: {} } })
      const result = manager.query({ id: created.id })
      expect(result.total).toBe(1)
      expect(result.tasks[0].id).toBe(created.id)
    })

    it('should return empty for non-existent id', () => {
      const result = manager.query({ id: 'non-existent' })
      expect(result.total).toBe(0)
    })
  })

  describe('state machine', () => {
    it('should pause a running task', async () => {
      const created = await manager.create({ workspaceId: 'test-ws', name: '任务', type: 'simple', action: { toolName: 'test', parameters: {} } })
      // 先设置为 running
      manager.sqlite.run('UPDATE task_meta SET status = @status WHERE id = @id', { status: 'running', id: created.id })
      await manager.pause(created.id)
      const task = manager.getById(created.id)
      expect(task!.status).toBe('paused')
    })

    it('should resume a paused task', async () => {
      const created = await manager.create({ workspaceId: 'test-ws', name: '任务', type: 'simple', action: { toolName: 'test', parameters: {} } })
      manager.sqlite.run('UPDATE task_meta SET status = @status WHERE id = @id', { status: 'paused', id: created.id })
      await manager.resume(created.id)
      const task = manager.getById(created.id)
      expect(task!.status).toBe('pending')
    })

    it('should cancel a task', async () => {
      const created = await manager.create({ workspaceId: 'test-ws', name: '任务', type: 'simple', action: { toolName: 'test', parameters: {} } })
      await manager.cancel(created.id, '不再需要')
      const task = manager.getById(created.id)
      expect(task!.status).toBe('cancelled')
      expect(task!.error).toBe('不再需要')
    })

    it('should throw on invalid transition', async () => {
      const created = await manager.create({ workspaceId: 'test-ws', name: '任务', type: 'simple', action: { toolName: 'test', parameters: {} } })
      // 从 pending 到 completed 是非法转换
      await expect(manager.complete(created.id)).rejects.toThrow('非法状态转换')
    })
  })

  describe('dependencies', () => {
    it('should add and remove dependencies', async () => {
      const taskA = await manager.create({ workspaceId: 'test-ws', name: '任务A', type: 'simple', action: { toolName: 'test', parameters: {} } })
      const taskB = await manager.create({ workspaceId: 'test-ws', name: '任务B', type: 'simple', action: { toolName: 'test', parameters: {} } })

      await manager.addDependency(taskB.id, taskA.id)
      const task = manager.getById(taskB.id)
      expect(task!.dependencies).toContain(taskA.id)

      await manager.removeDependency(taskB.id, taskA.id)
      const task2 = manager.getById(taskB.id)
      expect(task2!.dependencies || []).not.toContain(taskA.id)
    })
  })

  describe('stats', () => {
    it('should return correct stats', async () => {
      await manager.create({ workspaceId: 'test-ws', name: '任务1', type: 'simple', action: { toolName: 'test', parameters: {} } })
      await manager.create({ workspaceId: 'test-ws', name: '任务2', type: 'simple', action: { toolName: 'test', parameters: {} } })

      const stats = manager.stats()
      expect(stats.total).toBe(2)
      expect(stats.byStatus.pending).toBe(2)
      expect(stats.byType.simple).toBe(2)
    })
  })

  describe('cleanup', () => {
    it('should cleanup old completed tasks', async () => {
      const created = await manager.create({ workspaceId: 'test-ws', name: '任务', type: 'simple', action: { toolName: 'test', parameters: {} } })
      // 设置为 completed 并设置较早的 completed_at
      manager.sqlite.run(
        "UPDATE task_meta SET status = 'completed', completed_at = @completed_at, started_at = @started_at WHERE id = @id",
        { id: created.id, completed_at: Math.floor(Date.now() / 1000) - 86400 * 14, started_at: Math.floor(Date.now() / 1000) - 86400 * 14 - 60 },
      )

      const result = await manager.cleanup({ keepRecent: 0, olderThan: Math.floor(Date.now() / 1000) - 86400 * 7 })
      expect(result.removed).toBe(1)
    })
  })

  describe('export/import', () => {
    it('should export and import tasks', async () => {
      await manager.create({ workspaceId: 'test-ws', name: '任务1', type: 'simple', action: { toolName: 'test', parameters: {} } })

      const json = await manager.export()
      expect(json).toBeTruthy()

      const parsed = JSON.parse(json)
      expect(Array.isArray(parsed)).toBe(true)
      expect(parsed.length).toBe(1)
      expect(parsed[0].name).toBe('任务1')
    })

    it('should import tasks from JSON', async () => {
      const json = JSON.stringify([
        { name: '导入任务1', type: 'simple', action: { toolName: 'test', parameters: {} } },
        { name: '导入任务2', type: 'simple', action: { toolName: 'test', parameters: {} } },
      ])

      const result = await manager.import(json)
      expect(result.imported).toBe(2)
    })
  })
})