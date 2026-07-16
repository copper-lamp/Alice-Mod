/**
 * 任务工具单元测试 v2.0
 *
 * 覆盖收敛后的 6 个任务工具：
 * 1. task_create     — 单条 + 批量合一（items 切换）
 * 2. task_query      — detail / progress / list 三模式（mode 切换）
 * 3. task_update     — 更新属性（含 metadata / retry_config）
 * 4. task_control    — pause / resume / cancel / retry（含 force）
 * 5. task_decompose  — LLM 分解（含 max_subtasks / strategy）
 * 6. task_manage     — 9 action 合并（stats/cleanup/export/import/priority/add_dep/remove_dep/schedule/queue_status）
 *
 * 约定：
 * - 使用真实 SQLiteStore + TaskManager（不调用 init()，调度器不轮询，任务保持 pending）
 * - 每个工具至少 1 个 happy path + 1 个 error path
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { TaskManager } from '../../src/main/task/task-manager'
import { SQLiteStore } from '../../src/main/memory/sqlite-store'
import { taskCreate } from '../../src/main/task/tools/task_create'
import { taskQuery } from '../../src/main/task/tools/task_query'
import { taskUpdate } from '../../src/main/task/tools/task_update'
import { taskControl } from '../../src/main/task/tools/task_control'
import { taskDecompose } from '../../src/main/task/tools/task_decompose'
import { taskManage } from '../../src/main/task/tools/task_manage'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('Task Tools v2.0', () => {
  let dir: string
  let dbPath: string
  let sqlite: SQLiteStore
  let manager: TaskManager

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'task-tools-test-'))
    dbPath = join(dir, 'test.db')
    sqlite = new SQLiteStore(dbPath)
    manager = new TaskManager({}, { sqlite })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    manager.close()
    sqlite.close()
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
  })

  // ════════════════════════════════════════════
  // task_create
  // ════════════════════════════════════════════
  describe('task_create', () => {
    it('单条模式：创建简单任务并返回 id', async () => {
      const result = await taskCreate(manager, {
        name: '挖钻石',
        type: 'simple',
        action: { toolName: 'mine_block', parameters: { target: 'diamond_ore' } },
        priority: 'high',
        tags: ['mining'],
        metadata: { biome: 'cave' },
        retry_config: { maxRetries: 2, retryDelay: 5 },
      })
      expect(result.success).toBe(true)
      expect(result.data).toBeTruthy()
      expect(result.data!.id).toBeTruthy()
    })

    it('单条模式：支持依赖任务', async () => {
      const dep = await taskCreate(manager, {
        name: '准备工具', type: 'simple',
        action: { toolName: 'craft', parameters: {} },
      })
      const result = await taskCreate(manager, {
        name: '挖钻石', type: 'simple',
        action: { toolName: 'mine_block', parameters: {} },
        dependencies: [dep.data!.id],
      })
      expect(result.success).toBe(true)
    })

    it('批量模式：通过 items 创建多条任务', async () => {
      const result = await taskCreate(manager, {
        items: [
          { name: '任务1', type: 'simple', action: { toolName: 'test', parameters: {} } },
          { name: '任务2', type: 'simple', action: { toolName: 'test', parameters: {} } },
        ],
      })
      expect(result.success).toBe(true)
      expect(result.data!.count).toBe(2)
      expect(result.data!.ids).toHaveLength(2)
    })

    it('错误路径：单条模式缺少 name 和 type', async () => {
      const result = await taskCreate(manager, { priority: 'high' })
      expect(result.success).toBe(false)
      expect(result.error).toContain('name')
    })
  })

  // ════════════════════════════════════════════
  // task_query
  // ════════════════════════════════════════════
  describe('task_query', () => {
    it('list 模式（默认）：列出任务', async () => {
      await taskCreate(manager, { name: '任务1', type: 'simple', action: { toolName: 'test', parameters: {} } })
      const result = await taskQuery(manager, {})
      expect(result.success).toBe(true)
      expect(result.data!.total).toBeGreaterThanOrEqual(1)
      expect(result.data!.tasks.length).toBeGreaterThanOrEqual(1)
    })

    it('list 模式：支持 filter / limit / sort_by / sort_dir', async () => {
      await taskCreate(manager, { name: 'A', type: 'simple', action: { toolName: 't', parameters: {} }, priority: 'high' })
      await taskCreate(manager, { name: 'B', type: 'simple', action: { toolName: 't', parameters: {} }, priority: 'low' })
      const result = await taskQuery(manager, {
        filter: { priority: 'high' },
        sort_by: 'created_at',
        sort_dir: 'desc',
        limit: 10,
      })
      expect(result.success).toBe(true)
      expect(result.data!.tasks.every((t: any) => t.priority === 'high')).toBe(true)
    })

    it('detail 模式：按 ID 取详情', async () => {
      const created = await taskCreate(manager, { name: '详情任务', type: 'simple', action: { toolName: 't', parameters: {} } })
      const result = await taskQuery(manager, { mode: 'detail', task_id: created.data!.id })
      expect(result.success).toBe(true)
      expect(result.data!.task.name).toBe('详情任务')
    })

    it('progress 模式：取任务进度', async () => {
      const created = await taskCreate(manager, { name: '进度任务', type: 'simple', action: { toolName: 't', parameters: {} } })
      const result = await taskQuery(manager, { mode: 'progress', task_id: created.data!.id })
      expect(result.success).toBe(true)
      expect(result.data!.task_id).toBe(created.data!.id)
      expect(result.data!.status).toBe('pending')
      expect(result.data!.progress).toBe(0)
    })

    it('错误路径：detail 模式缺 task_id', async () => {
      const result = await taskQuery(manager, { mode: 'detail' })
      expect(result.success).toBe(false)
      expect(result.error).toContain('task_id')
    })

    it('错误路径：detail 模式任务不存在', async () => {
      const result = await taskQuery(manager, { mode: 'detail', task_id: 'non-existent-id' })
      expect(result.success).toBe(false)
      expect(result.error).toContain('不存在')
    })

    it('错误路径：progress 模式缺 task_id', async () => {
      const result = await taskQuery(manager, { mode: 'progress' })
      expect(result.success).toBe(false)
      expect(result.error).toContain('task_id')
    })
  })

  // ════════════════════════════════════════════
  // task_update
  // ════════════════════════════════════════════
  describe('task_update', () => {
    it('更新多个字段并返回 updated_fields（含 metadata / retry_config）', async () => {
      const created = await taskCreate(manager, { name: '原名', type: 'simple', action: { toolName: 't', parameters: {} } })
      const result = await taskUpdate(manager, {
        task_id: created.data!.id,
        name: '新名',
        description: '更新后描述',
        priority: 'high',
        tags: ['a', 'b'],
        metadata: { key: 'value' },
        retry_config: { maxRetries: 3, retryDelay: 10 },
        timeout: 600,
      })
      expect(result.success).toBe(true)
      expect(result.data!.updated_fields).toEqual(
        expect.arrayContaining(['name', 'description', 'priority', 'tags', 'metadata', 'retry_config', 'timeout']),
      )
      // 校验落库
      const detail = await taskQuery(manager, { mode: 'detail', task_id: created.data!.id })
      expect(detail.data!.task.name).toBe('新名')
      expect(detail.data!.task.priority).toBe('high')
      expect(detail.data!.task.metadata).toEqual({ key: 'value' })
      expect(detail.data!.task.retryConfig.maxRetries).toBe(3)
    })

    it('错误路径：未提供任何更新字段', async () => {
      const created = await taskCreate(manager, { name: '任务', type: 'simple', action: { toolName: 't', parameters: {} } })
      const result = await taskUpdate(manager, { task_id: created.data!.id })
      expect(result.success).toBe(false)
      expect(result.error).toContain('未提供')
    })
  })

  // ════════════════════════════════════════════
  // task_control
  // ════════════════════════════════════════════
  describe('task_control', () => {
    it('pause → resume → cancel 流程', async () => {
      const created = await taskCreate(manager, { name: '控制任务', type: 'simple', action: { toolName: 't', parameters: {} } })
      // pending → paused
      const pauseRes = await taskControl(manager, { task_id: created.data!.id, action: 'pause' })
      expect(pauseRes.success).toBe(true)
      // paused → pending
      const resumeRes = await taskControl(manager, { task_id: created.data!.id, action: 'resume' })
      expect(resumeRes.success).toBe(true)
      // pending → cancelled
      const cancelRes = await taskControl(manager, { task_id: created.data!.id, action: 'cancel', reason: '不再需要' })
      expect(cancelRes.success).toBe(true)
      const detail = await taskQuery(manager, { mode: 'detail', task_id: created.data!.id })
      expect(detail.data!.task.status).toBe('cancelled')
    })

    it('retry：对失败任务重试，retry_count 自增', async () => {
      const created = await taskCreate(manager, { name: '失败任务', type: 'simple', action: { toolName: 't', parameters: {} } })
      // 直接置为 failed
      manager.sqlite.run("UPDATE task_meta SET status = 'failed' WHERE id = @id", { id: created.data!.id })
      const result = await taskControl(manager, { task_id: created.data!.id, action: 'retry' })
      expect(result.success).toBe(true)
      const detail = await taskQuery(manager, { mode: 'detail', task_id: created.data!.id })
      expect(detail.data!.task.status).toBe('pending')
      expect(detail.data!.task.retryCount).toBe(1)
    })

    it('retry：force 参数可重试非失败任务', async () => {
      const created = await taskCreate(manager, { name: '强制重试', type: 'simple', action: { toolName: 't', parameters: {} } })
      // pending 状态 + force
      const result = await taskControl(manager, { task_id: created.data!.id, action: 'retry', force: true })
      expect(result.success).toBe(true)
    })

    it('错误路径：未知 action', async () => {
      const created = await taskCreate(manager, { name: '任务', type: 'simple', action: { toolName: 't', parameters: {} } })
      const result = await taskControl(manager, { task_id: created.data!.id, action: 'unknown' })
      expect(result.success).toBe(false)
      expect(result.error).toContain('未知控制动作')
    })

    it('错误路径：对非失败任务重试且未 force', async () => {
      const created = await taskCreate(manager, { name: '任务', type: 'simple', action: { toolName: 't', parameters: {} } })
      const result = await taskControl(manager, { task_id: created.data!.id, action: 'retry' })
      expect(result.success).toBe(false)
      expect(result.error).toContain('失败的任务可以重试')
    })
  })

  // ════════════════════════════════════════════
  // task_decompose
  // ════════════════════════════════════════════
  describe('task_decompose', () => {
    it('分解复杂任务并返回子任务列表（含 max_subtasks / strategy）', async () => {
      const result = await taskDecompose(manager, {
        task_description: '建造一个木屋',
        max_subtasks: 5,
        strategy: 'sequential',
        context: { biome: 'forest' },
      })
      expect(result.success).toBe(true)
      expect(result.data!.subtasks.length).toBeGreaterThan(0)
      expect(result.data!.summary).toContain('建造一个木屋')
    })

    it('错误路径：manager.decompose 抛错时工具返回失败', async () => {
      vi.spyOn(manager, 'decompose').mockRejectedValueOnce(new Error('LLM 服务不可用'))
      const result = await taskDecompose(manager, { task_description: '测试' })
      expect(result.success).toBe(false)
      expect(result.error).toContain('任务分解失败')
      expect(result.error).toContain('LLM 服务不可用')
    })
  })

  // ════════════════════════════════════════════
  // task_manage
  // ════════════════════════════════════════════
  describe('task_manage', () => {
    it('action=stats：返回统计信息', async () => {
      await taskCreate(manager, { name: '任务', type: 'simple', action: { toolName: 't', parameters: {} } })
      const result = await taskManage(manager, { action: 'stats' })
      expect(result.success).toBe(true)
      expect(result.data!.total).toBeGreaterThanOrEqual(1)
      expect(result.data!.byStatus).toBeDefined()
    })

    it('action=cleanup：按 status_filter 清理已完成任务', async () => {
      const created = await taskCreate(manager, { name: '旧任务', type: 'simple', action: { toolName: 't', parameters: {} } })
      manager.sqlite.run(
        "UPDATE task_meta SET status = 'completed', completed_at = @completed_at WHERE id = @id",
        { id: created.data!.id, completed_at: Math.floor(Date.now() / 1000) - 86400 * 14 },
      )
      const result = await taskManage(manager, {
        action: 'cleanup',
        keep_recent: 0,
        older_than: Math.floor(Date.now() / 1000) - 86400 * 7,
        status_filter: ['completed'],
      })
      expect(result.success).toBe(true)
    })

    it('action=export：导出任务为 JSON（含 export_filter）', async () => {
      await taskCreate(manager, { name: '导出任务', type: 'simple', action: { toolName: 't', parameters: {} } })
      const result = await taskManage(manager, { action: 'export', export_filter: { type: 'simple' } })
      expect(result.success).toBe(true)
      const parsed = JSON.parse(result.data!.data)
      expect(parsed.length).toBeGreaterThanOrEqual(1)
    })

    it('action=import：导入任务', async () => {
      const data = JSON.stringify([{ name: '导入任务', type: 'simple', action: { toolName: 't', parameters: {} } }])
      const result = await taskManage(manager, { action: 'import', data })
      expect(result.success).toBe(true)
      expect(result.data!.imported).toBe(1)
    })

    it('action=priority：设置优先级', async () => {
      const created = await taskCreate(manager, { name: '任务', type: 'simple', action: { toolName: 't', parameters: {} } })
      const result = await taskManage(manager, { action: 'priority', task_id: created.data!.id, priority: 'critical' })
      expect(result.success).toBe(true)
      const detail = await taskQuery(manager, { mode: 'detail', task_id: created.data!.id })
      expect(detail.data!.task.priority).toBe('critical')
    })

    it('action=add_dep / remove_dep：添加和移除依赖', async () => {
      const taskA = await taskCreate(manager, { name: 'A', type: 'simple', action: { toolName: 't', parameters: {} } })
      const taskB = await taskCreate(manager, { name: 'B', type: 'simple', action: { toolName: 't', parameters: {} } })
      const addRes = await taskManage(manager, { action: 'add_dep', task_id: taskB.data!.id, depends_on_id: taskA.data!.id })
      expect(addRes.success).toBe(true)
      const removeRes = await taskManage(manager, { action: 'remove_dep', task_id: taskB.data!.id, depends_on_id: taskA.data!.id })
      expect(removeRes.success).toBe(true)
    })

    it('action=schedule：调度任务（delayed 模式）', async () => {
      const created = await taskCreate(manager, { name: '调度任务', type: 'simple', action: { toolName: 't', parameters: {} } })
      const result = await taskManage(manager, { action: 'schedule', task_id: created.data!.id, mode: 'delayed', delay: 60 })
      expect(result.success).toBe(true)
      expect(result.data!.id).toBe(created.data!.id)
      expect(result.data!.scheduledAt).toBeGreaterThan(0)
    })

    it('action=queue_status：返回队列状态', async () => {
      const result = await taskManage(manager, { action: 'queue_status' })
      expect(result.success).toBe(true)
      expect(result.data!.maxConcurrent).toBeGreaterThan(0)
      expect(typeof result.data!.pendingCount).toBe('number')
    })

    it('错误路径：action=import 缺 data 参数', async () => {
      const result = await taskManage(manager, { action: 'import' })
      expect(result.success).toBe(false)
      expect(result.error).toContain('data')
    })

    it('错误路径：action=priority 缺 task_id', async () => {
      const result = await taskManage(manager, { action: 'priority', priority: 'high' })
      expect(result.success).toBe(false)
      expect(result.error).toContain('task_id')
    })

    it('错误路径：action=add_dep 缺 depends_on_id', async () => {
      const created = await taskCreate(manager, { name: '任务', type: 'simple', action: { toolName: 't', parameters: {} } })
      const result = await taskManage(manager, { action: 'add_dep', task_id: created.data!.id })
      expect(result.success).toBe(false)
      expect(result.error).toContain('depends_on_id')
    })

    it('错误路径：未知 action', async () => {
      const result = await taskManage(manager, { action: 'unknown_action' })
      expect(result.success).toBe(false)
      expect(result.error).toContain('未知 action')
    })
  })
})
