/**
 * 任务系统集成测试
 *
 * 测试全链路：创建 → 调度 → 执行 → 完成
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { TaskManager } from '../../src/main/task/task-manager'
import { SQLiteStore } from '../../src/main/memory/sqlite-store'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('Task System Integration', () => {
  let dbPath: string
  let sqlite: SQLiteStore
  let manager: TaskManager

  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), 'task-integration-'))
    dbPath = join(dir, 'test.db')
    sqlite = new SQLiteStore(dbPath)
    manager = new TaskManager({}, { sqlite })
  })

  afterEach(() => {
    manager.close()
    sqlite.close()
    try { rmSync(dbPath, { force: true }) } catch { /* ignore */ }
  })

  it('should create simple task, then complete it', async () => {
    const result = await manager.create({
      workspaceId: 'test-ws',
      name: '挖钻石',
      type: 'simple',
      action: { toolName: 'mine_block', parameters: { target: 'diamond_ore' } },
    })

    // 验证创建
    let task = manager.getById(result.id)
    expect(task).not.toBeNull()
    expect(task!.status).toBe('pending')

    // 模拟调度器设为 running
    manager.sqlite.run('UPDATE task_meta SET status = @status, started_at = @now WHERE id = @id', {
      status: 'running',
      id: result.id,
      now: Math.floor(Date.now() / 1000),
    })

    // 手动完成
    await manager.complete(result.id, { blocks: 10 })

    task = manager.getById(result.id)
    expect(task!.status).toBe('completed')
    expect(task!.progress).toBe(100)
    expect(task!.result?.blocks).toBe(10)
  })

  it('should handle dependency chain', async () => {
    // 创建任务 A
    const taskA = await manager.create({
      workspaceId: 'test-ws',
      name: '收集木材',
      type: 'simple',
      action: { toolName: 'collect', parameters: { resource: 'wood' } },
    })

    // 创建任务 B（依赖 A）
    const taskB = await manager.create({
      workspaceId: 'test-ws',
      name: '建造木屋',
      type: 'simple',
      action: { toolName: 'build', parameters: { structure: 'wooden_house' } },
      dependencies: [taskA.id],
    })

    // 验证依赖
    const task = manager.getById(taskB.id)
    expect(task!.dependencies).toContain(taskA.id)

    // 完成 A
    manager.sqlite.run('UPDATE task_meta SET status = @status, started_at = @now WHERE id = @id', {
      status: 'running', id: taskA.id, now: Math.floor(Date.now() / 1000),
    })
    await manager.complete(taskA.id, { wood: 10 })

    // 验证 A 已完成
    const taskACompleted = manager.getById(taskA.id)
    expect(taskACompleted!.status).toBe('completed')

    // B 应该还是 pending（等待调度器拾取）
    const taskBPending = manager.getById(taskB.id)
    expect(taskBPending!.status).toBe('pending')
  })

  it('should handle retry on failure', async () => {
    const result = await manager.create({
      workspaceId: 'test-ws',
      name: '会失败的任务',
      type: 'simple',
      action: { toolName: 'fail', parameters: {} },
      retryConfig: { maxRetries: 2, retryDelay: 1, backoffMultiplier: 1.0 },
    })

    // 模拟执行失败
    manager.sqlite.run('UPDATE task_meta SET status = @status, started_at = @now WHERE id = @id', {
      status: 'running', id: result.id, now: Math.floor(Date.now() / 1000),
    })

    // 直接调用 fail 然后 retry（跳过超时等待）
    await manager.fail(result.id, '工具执行失败')

    // 重试
    await manager.retry(result.id, true)

    const task = manager.getById(result.id)
    expect(task!.status).toBe('pending')
    expect(task!.retryCount).toBe(1)
  })

  it('should persist tasks across restarts', async () => {
    // 创建任务
    const result = await manager.create({
      workspaceId: 'test-ws',
      name: '持久化任务',
      type: 'simple',
      action: { toolName: 'test', parameters: {} },
    })

    // 关闭当前 manager
    manager.close()

    // 模拟重启
    const sqlite2 = new SQLiteStore(dbPath)
    const manager2 = new TaskManager({}, { sqlite: sqlite2 })

    // 验证任务仍存在
    const task = manager2.getById(result.id)
    expect(task).not.toBeNull()
    expect(task!.name).toBe('持久化任务')
    expect(task!.status).toBe('pending')

    manager2.close()
    sqlite2.close()
  })

  it('should create all 4 task types', async () => {
    const simple = await manager.create({
      workspaceId: 'test-ws', name: '简单', type: 'simple',
      action: { toolName: 'test', parameters: {} },
    })
    const composite = await manager.create({
      workspaceId: 'test-ws', name: '复合', type: 'composite',
      subtaskIds: ['sub1', 'sub2'],
    })
    const loop = await manager.create({
      workspaceId: 'test-ws', name: '循环', type: 'loop',
      action: { toolName: 'test', parameters: {} },
      loopConfig: { mode: 'count', count: 3, maxIterations: 100 },
    })
    const conditional = await manager.create({
      workspaceId: 'test-ws', name: '条件', type: 'conditional',
      action: { toolName: 'test', parameters: {} },
      condition: { type: 'time', value: Date.now() + 1000 },
    })

    expect(manager.getById(simple.id)!.type).toBe('simple')
    expect(manager.getById(composite.id)!.type).toBe('composite')
    expect(manager.getById(loop.id)!.type).toBe('loop')
    expect(manager.getById(conditional.id)!.type).toBe('conditional')
  })

  it('should return correct stats', async () => {
    // 创建各种状态的任务
    const t1 = await manager.create({ workspaceId: 'test-ws', name: '任务1', type: 'simple', action: { toolName: 'test', parameters: {} } })
    const t2 = await manager.create({ workspaceId: 'test-ws', name: '任务2', type: 'simple', action: { toolName: 'test', parameters: {} } })

    // 完成一个
    manager.sqlite.run('UPDATE task_meta SET status = @status, started_at = @now WHERE id = @id', {
      status: 'running', id: t1.id, now: Math.floor(Date.now() / 1000),
    })
    await manager.complete(t1.id, {})

    const stats = manager.stats()
    expect(stats.total).toBe(2)
    expect(stats.byStatus.completed).toBe(1)
    expect(stats.byStatus.pending).toBe(1)
    expect(stats.completionRate).toBe(50)
  })
})