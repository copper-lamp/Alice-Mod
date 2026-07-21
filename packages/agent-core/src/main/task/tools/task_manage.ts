/**
 * task_manage — 任务管理工具（4 种 action 合并）
 *
 * v2.0 精简版：add_dep / remove_dep / schedule / queue_status
 * 移除了：stats(系统级), cleanup(系统级), export(系统级), import(系统级), priority(与 task_update 重复)
 */

import type { ToolSchema, ToolResult } from '@mcagent/shared'
import { ToolCategory } from '@mcagent/shared'
import type { TaskManager } from '../task-manager'

export const TASK_MANAGE_TOOL: ToolSchema = {
  name: 'task_manage',
  description: '任务管理操作。action: add_dep=加依赖, remove_dep=移除依赖, schedule=调度, queue_status=队列状态',
  category: ToolCategory.Task,
  parameters: {
    action: {
      type: 'string', description: '管理动作', required: true,
      enum: ['add_dep', 'remove_dep', 'schedule', 'queue_status'],
    },
    task_id: { type: 'string', description: '任务 ID（add_dep/remove_dep/schedule 时必填）', required: false },
    depends_on_id: { type: 'string', description: '依赖的任务 ID（action=add_dep/remove_dep 时必填）', required: false },
    mode: {
      type: 'string', description: '调度模式（action=schedule 时必填）',
      enum: ['immediate', 'delayed', 'cron', 'event'], required: false,
    },
    delay: { type: 'number', description: '延迟秒数（mode=delayed）', required: false },
    cron: { type: 'string', description: 'cron 表达式（mode=cron）', required: false },
    event: { type: 'string', description: '事件名（mode=event）', required: false },
  },
}

export async function taskManage(
  manager: TaskManager,
  params: Record<string, any>,
): Promise<ToolResult<unknown>> {
  const start = Date.now()
  try {
    switch (params.action) {
      // ── 添加依赖 ──
      case 'add_dep': {
        if (!params.task_id || !params.depends_on_id) {
          return { success: false, error: 'action=add_dep 需要 task_id 和 depends_on_id', duration: Date.now() - start }
        }
        await manager.addDependency(params.task_id, params.depends_on_id)
        return { success: true, duration: Date.now() - start }
      }

      // ── 移除依赖 ──
      case 'remove_dep': {
        if (!params.task_id || !params.depends_on_id) {
          return { success: false, error: 'action=remove_dep 需要 task_id 和 depends_on_id', duration: Date.now() - start }
        }
        await manager.removeDependency(params.task_id, params.depends_on_id)
        return { success: true, duration: Date.now() - start }
      }

      // ── 调度 ──
      case 'schedule': {
        if (!params.task_id || !params.mode) {
          return { success: false, error: 'action=schedule 需要 task_id 和 mode', duration: Date.now() - start }
        }
        const result = await manager.schedule(params.task_id, {
          mode: params.mode,
          delay: params.delay,
          cron: params.cron,
          event: params.event,
        })
        return { success: true, data: result, duration: Date.now() - start }
      }

      // ── 队列状态 ──
      case 'queue_status': {
        const result = manager.scheduler.getQueueStatus()
        return { success: true, data: result, duration: Date.now() - start }
      }

      default:
        return { success: false, error: `未知 action: ${params.action}`, duration: Date.now() - start }
    }
  } catch (err) {
    return { success: false, error: `管理操作失败: ${(err as Error).message}`, duration: Date.now() - start }
  }
}