/**
 * task_manage — 任务管理工具（9 种 action 合并）
 *
 * v2.0：stats / cleanup / export / import / priority / add_dep / remove_dep / schedule / queue_status
 * 全部收敛到 action 枚举。
 */

import type { ToolSchema, ToolResult } from '@mcagent/shared'
import { ToolCategory } from '@mcagent/shared'
import type { TaskManager } from '../task-manager'

export const TASK_MANAGE_TOOL: ToolSchema = {
  name: 'task_manage',
  description: '任务管理操作。action: stats=统计, cleanup=清理, export=导出, import=导入, priority=设优先级, add_dep=加依赖, remove_dep=移除依赖, schedule=调度, queue_status=队列状态',
  category: ToolCategory.Task,
  parameters: {
    action: {
      type: 'string', description: '管理动作', required: true,
      enum: ['stats', 'cleanup', 'export', 'import', 'priority', 'add_dep', 'remove_dep', 'schedule', 'queue_status'],
    },
    // ── priority / add_dep / remove_dep / schedule ──
    task_id: { type: 'string', description: '任务 ID（priority/add_dep/remove_dep/schedule 时必填）', required: false },
    priority: {
      type: 'string', description: '新优先级（action=priority 时必填）',
      enum: ['critical', 'high', 'normal', 'low'], required: false,
    },
    depends_on_id: { type: 'string', description: '依赖的任务 ID（action=add_dep/remove_dep 时必填）', required: false },
    mode: {
      type: 'string', description: '调度模式（action=schedule 时必填）',
      enum: ['immediate', 'delayed', 'cron', 'event'], required: false,
    },
    delay: { type: 'number', description: '延迟秒数（mode=delayed）', required: false },
    cron: { type: 'string', description: 'cron 表达式（mode=cron）', required: false },
    event: { type: 'string', description: '事件名（mode=event）', required: false },
    // ── cleanup ──
    keep_recent: { type: 'number', description: '保留最近 N 条（action=cleanup，默认 100）', required: false },
    older_than: { type: 'number', description: '清理早于该秒数的任务（action=cleanup，默认 604800）', required: false },
    status_filter: { type: 'array', description: '按状态过滤清理（action=cleanup）', required: false },
    // ── export / import ──
    format: { type: 'string', description: '导出格式（action=export，默认 json）', enum: ['json', 'csv'], required: false },
    export_filter: { type: 'object', description: '导出过滤条件（action=export）', required: false },
    data: { type: 'string', description: 'JSON 字符串（action=import 时必填）', required: false },
  },
}

export async function taskManage(
  manager: TaskManager,
  params: Record<string, any>,
): Promise<ToolResult<unknown>> {
  const start = Date.now()
  try {
    switch (params.action) {
      // ── 统计 ──
      case 'stats': {
        const result = manager.stats()
        return { success: true, data: result, duration: Date.now() - start }
      }

      // ── 清理 ──
      case 'cleanup': {
        const result = await manager.cleanup({
          keepRecent: params.keep_recent,
          olderThan: params.older_than,
          statuses: params.status_filter,
        })
        return { success: true, data: result, duration: Date.now() - start }
      }

      // ── 导出 ──
      case 'export': {
        const result = await manager.export({
          type: params.export_filter?.type,
          status: params.export_filter?.status,
          workspaceId: params.export_filter?.workspace_id,
        })
        return { success: true, data: { data: result }, duration: Date.now() - start }
      }

      // ── 导入 ──
      case 'import': {
        if (!params.data) {
          return { success: false, error: 'action=import 需要 data 参数', duration: Date.now() - start }
        }
        const result = await manager.import(params.data)
        return { success: true, data: result, duration: Date.now() - start }
      }

      // ── 设置优先级 ──
      case 'priority': {
        if (!params.task_id || !params.priority) {
          return { success: false, error: 'action=priority 需要 task_id 和 priority', duration: Date.now() - start }
        }
        await manager.setPriority(params.task_id, params.priority)
        return { success: true, duration: Date.now() - start }
      }

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
