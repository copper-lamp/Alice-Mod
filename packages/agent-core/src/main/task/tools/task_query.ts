/**
 * task_query / task_get_by_id / task_get_progress / task_list — 任务查询工具
 */

import type { ToolSchema, ToolResult } from '@mcagent/shared'
import { ToolCategory } from '@mcagent/shared'
import type { TaskManager } from '../task-manager'

export const TASK_QUERY_TOOL: ToolSchema = {
  name: 'task_query',
  description: '按条件查询任务列表，支持状态/优先级/类型/标签过滤和排序',
  category: ToolCategory.Task,
  parameters: {
    status: { type: 'string', description: '按状态筛选', enum: ['pending', 'running', 'paused', 'completed', 'failed', 'cancelled'], required: false },
    priority: { type: 'string', description: '按优先级筛选', enum: ['critical', 'high', 'normal', 'low'], required: false },
    type: { type: 'string', description: '按类型筛选', enum: ['simple', 'composite', 'loop', 'conditional'], required: false },
    tags: { type: 'array', description: '按标签筛选', required: false },
    workspace_id: { type: 'string', description: '工作区 ID', required: false },
    limit: { type: 'number', description: '返回数量上限（默认 20）', required: false },
    offset: { type: 'number', description: '偏移量', required: false },
    sort_by: { type: 'string', description: '排序字段', enum: ['priority', 'created_at', 'updated_at', 'progress'], required: false },
    sort_dir: { type: 'string', description: '排序方向', enum: ['asc', 'desc'], required: false },
  },
}

export const TASK_GET_BY_ID_TOOL: ToolSchema = {
  name: 'task_get_by_id',
  description: '按 ID 获取单个任务详情',
  category: ToolCategory.Task,
  parameters: {
    task_id: { type: 'string', description: '任务 ID', required: true },
  },
}

export const TASK_GET_PROGRESS_TOOL: ToolSchema = {
  name: 'task_get_progress',
  description: '获取任务进度',
  category: ToolCategory.Task,
  parameters: {
    task_id: { type: 'string', description: '任务 ID', required: true },
  },
}

export const TASK_LIST_TOOL: ToolSchema = {
  name: 'task_list',
  description: '列出所有任务（分页）',
  category: ToolCategory.Task,
  parameters: {
    workspace_id: { type: 'string', description: '工作区 ID', required: false },
    limit: { type: 'number', description: '返回数量上限（默认 20）', required: false },
    offset: { type: 'number', description: '偏移量', required: false },
  },
}

export async function taskQuery(
  manager: TaskManager,
  params: Record<string, any>,
): Promise<ToolResult<unknown>> {
  const start = Date.now()
  try {
    const result = manager.query({
      status: params.status,
      priority: params.priority,
      type: params.type,
      tags: params.tags,
      workspaceId: params.workspace_id,
      limit: params.limit,
      offset: params.offset,
      sortBy: params.sort_by,
      sortDir: params.sort_dir,
    })
    return { success: true, data: result, duration: Date.now() - start }
  } catch (err) {
    return { success: false, error: `查询失败: ${(err as Error).message}`, duration: Date.now() - start }
  }
}

export async function taskGetById(
  manager: TaskManager,
  params: { task_id: string },
): Promise<ToolResult<unknown>> {
  const start = Date.now()
  try {
    const result = manager.getById(params.task_id)
    return { success: true, data: result, duration: Date.now() - start }
  } catch (err) {
    return { success: false, error: `获取失败: ${(err as Error).message}`, duration: Date.now() - start }
  }
}

export async function taskGetProgress(
  manager: TaskManager,
  params: { task_id: string },
): Promise<ToolResult<unknown>> {
  const start = Date.now()
  try {
    const result = manager.getProgress(params.task_id)
    return { success: true, data: result, duration: Date.now() - start }
  } catch (err) {
    return { success: false, error: `获取进度失败: ${(err as Error).message}`, duration: Date.now() - start }
  }
}

export async function taskList(
  manager: TaskManager,
  params: { workspace_id?: string; limit?: number; offset?: number },
): Promise<ToolResult<unknown>> {
  const start = Date.now()
  try {
    const result = manager.list({
      workspaceId: params.workspace_id,
      limit: params.limit,
      offset: params.offset,
    })
    return { success: true, data: result, duration: Date.now() - start }
  } catch (err) {
    return { success: false, error: `列表查询失败: ${(err as Error).message}`, duration: Date.now() - start }
  }
}