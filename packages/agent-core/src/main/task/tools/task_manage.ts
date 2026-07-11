/**
 * task_manage — 任务管理工具（统计/清理/导出/导入/优先级/依赖/调度）
 */

import type { ToolSchema, ToolResult } from '@mcagent/shared'
import { ToolCategory } from '@mcagent/shared'
import type { TaskManager } from '../task-manager'

export const TASK_STATS_TOOL: ToolSchema = {
  name: 'task_stats',
  description: '查看任务系统统计信息，包括总数、按状态/类型/优先级分布、完成率、平均耗时',
  category: ToolCategory.Task,
  parameters: {},
}

export const TASK_CLEANUP_TOOL: ToolSchema = {
  name: 'task_cleanup',
  description: '清理已完成/失败/取消的任务，保留最近 N 条',
  category: ToolCategory.Task,
  parameters: {
    keep_recent: { type: 'number', description: '保留最近 N 条（默认 100）', required: false },
    older_than: { type: 'number', description: '清理早于该时间戳的任务（默认 7 天前）', required: false },
  },
}

export const TASK_EXPORT_TOOL: ToolSchema = {
  name: 'task_export',
  description: '导出任务数据为 JSON 格式',
  category: ToolCategory.Task,
  parameters: {
    type: { type: 'string', description: '按任务类型筛选导出', required: false },
    status: { type: 'string', description: '按状态筛选导出', required: false },
    workspace_id: { type: 'string', description: '工作区 ID', required: false },
  },
}

export const TASK_IMPORT_TOOL: ToolSchema = {
  name: 'task_import',
  description: '从 JSON 格式导入任务数据',
  category: ToolCategory.Task,
  parameters: {
    json: { type: 'string', description: 'JSON 格式的任务数据字符串', required: true },
  },
}

export const TASK_SET_PRIORITY_TOOL: ToolSchema = {
  name: 'task_set_priority',
  description: '设置任务优先级',
  category: ToolCategory.Task,
  parameters: {
    task_id: { type: 'string', description: '任务 ID', required: true },
    priority: { type: 'string', description: '新优先级', enum: ['critical', 'high', 'normal', 'low'], required: true },
  },
}

export const TASK_ADD_DEPENDENCY_TOOL: ToolSchema = {
  name: 'task_add_dependency',
  description: '为任务添加依赖（依赖的任务完成后，当前任务才会执行）',
  category: ToolCategory.Task,
  parameters: {
    task_id: { type: 'string', description: '任务 ID', required: true },
    depends_on_id: { type: 'string', description: '依赖的任务 ID', required: true },
  },
}

export const TASK_REMOVE_DEPENDENCY_TOOL: ToolSchema = {
  name: 'task_remove_dependency',
  description: '移除任务依赖',
  category: ToolCategory.Task,
  parameters: {
    task_id: { type: 'string', description: '任务 ID', required: true },
    depends_on_id: { type: 'string', description: '要移除的依赖任务 ID', required: true },
  },
}

export const TASK_SCHEDULE_TOOL: ToolSchema = {
  name: 'task_schedule',
  description: '调度任务执行（设置延迟/定时/事件触发）',
  category: ToolCategory.Task,
  parameters: {
    task_id: { type: 'string', description: '任务 ID', required: true },
    mode: { type: 'string', description: '调度模式', enum: ['immediate', 'delayed', 'cron', 'event'], required: true },
    delay: { type: 'number', description: '延迟时间（秒，mode=delayed 时有效）', required: false },
    cron: { type: 'string', description: 'cron 表达式（mode=cron 时有效）', required: false },
    event: { type: 'string', description: '触发事件名（mode=event 时有效）', required: false },
  },
}

export const TASK_QUEUE_STATUS_TOOL: ToolSchema = {
  name: 'task_queue_status',
  description: '查看调度队列状态',
  category: ToolCategory.Task,
  parameters: {},
}

// ════════════════════════════════════════════════════════════════
// 执行函数
// ════════════════════════════════════════════════════════════════

export async function taskStats(
  manager: TaskManager,
): Promise<ToolResult<unknown>> {
  const start = Date.now()
  try {
    const result = manager.stats()
    return { success: true, data: result, duration: Date.now() - start }
  } catch (err) {
    return { success: false, error: `统计查询失败: ${(err as Error).message}`, duration: Date.now() - start }
  }
}

export async function taskCleanup(
  manager: TaskManager,
  params: { keep_recent?: number; older_than?: number },
): Promise<ToolResult<unknown>> {
  const start = Date.now()
  try {
    const result = await manager.cleanup({
      keepRecent: params.keep_recent,
      olderThan: params.older_than,
    })
    return { success: true, data: result, duration: Date.now() - start }
  } catch (err) {
    return { success: false, error: `清理失败: ${(err as Error).message}`, duration: Date.now() - start }
  }
}

export async function taskExport(
  manager: TaskManager,
  params: { type?: string; status?: string; workspace_id?: string },
): Promise<ToolResult<string>> {
  const start = Date.now()
  try {
    const result = await manager.export({
      type: params.type as any,
      status: params.status as any,
      workspaceId: params.workspace_id,
    })
    return { success: true, data: result, duration: Date.now() - start }
  } catch (err) {
    return { success: false, error: `导出失败: ${(err as Error).message}`, duration: Date.now() - start }
  }
}

export async function taskImport(
  manager: TaskManager,
  params: { json: string },
): Promise<ToolResult<unknown>> {
  const start = Date.now()
  try {
    const result = await manager.import(params.json)
    return { success: true, data: result, duration: Date.now() - start }
  } catch (err) {
    return { success: false, error: `导入失败: ${(err as Error).message}`, duration: Date.now() - start }
  }
}

export async function taskSetPriority(
  manager: TaskManager,
  params: { task_id: string; priority: string },
): Promise<ToolResult<void>> {
  const start = Date.now()
  try {
    await manager.setPriority(params.task_id, params.priority as any)
    return { success: true, duration: Date.now() - start }
  } catch (err) {
    return { success: false, error: `设置优先级失败: ${(err as Error).message}`, duration: Date.now() - start }
  }
}

export async function taskAddDependency(
  manager: TaskManager,
  params: { task_id: string; depends_on_id: string },
): Promise<ToolResult<void>> {
  const start = Date.now()
  try {
    await manager.addDependency(params.task_id, params.depends_on_id)
    return { success: true, duration: Date.now() - start }
  } catch (err) {
    return { success: false, error: `添加依赖失败: ${(err as Error).message}`, duration: Date.now() - start }
  }
}

export async function taskRemoveDependency(
  manager: TaskManager,
  params: { task_id: string; depends_on_id: string },
): Promise<ToolResult<void>> {
  const start = Date.now()
  try {
    await manager.removeDependency(params.task_id, params.depends_on_id)
    return { success: true, duration: Date.now() - start }
  } catch (err) {
    return { success: false, error: `移除依赖失败: ${(err as Error).message}`, duration: Date.now() - start }
  }
}

export async function taskSchedule(
  manager: TaskManager,
  params: { task_id: string; mode: string; delay?: number; cron?: string; event?: string },
): Promise<ToolResult<unknown>> {
  const start = Date.now()
  try {
    const result = await manager.schedule(params.task_id, {
      mode: params.mode as any,
      delay: params.delay,
      cron: params.cron,
      event: params.event,
    })
    return { success: true, data: result, duration: Date.now() - start }
  } catch (err) {
    return { success: false, error: `调度失败: ${(err as Error).message}`, duration: Date.now() - start }
  }
}

export async function taskQueueStatus(
  manager: TaskManager,
): Promise<ToolResult<unknown>> {
  const start = Date.now()
  try {
    const result = manager.scheduler.getQueueStatus()
    return { success: true, data: result, duration: Date.now() - start }
  } catch (err) {
    return { success: false, error: `获取队列状态失败: ${(err as Error).message}`, duration: Date.now() - start }
  }
}