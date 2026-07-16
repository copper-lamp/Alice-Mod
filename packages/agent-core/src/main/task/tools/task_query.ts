/**
 * task_query — 任务查询工具（detail / progress / list 三模式合一）
 *
 * v2.0：通过 mode 参数复用同一工具。
 */

import type { ToolSchema, ToolResult } from '@mcagent/shared'
import { ToolCategory } from '@mcagent/shared'
import type { TaskManager } from '../task-manager'

export const TASK_QUERY_TOOL: ToolSchema = {
  name: 'task_query',
  description: '查询任务。mode=detail 按 ID 取详情；mode=progress 取进度；mode=list 按条件列出',
  category: ToolCategory.Task,
  parameters: {
    mode: {
      type: 'string', description: '查询模式（默认 list）',
      enum: ['detail', 'progress', 'list'], required: false,
    },
    // ── detail / progress 模式 ──
    task_id: { type: 'string', description: '任务 ID（mode=detail/progress 时必填）', required: false },
    // ── list 模式 ──
    filter: { type: 'object', description: '过滤条件 { status?, priority?, type?, tags?, workspace_id? }', required: false },
    limit: { type: 'number', description: '返回上限（默认 50）', required: false },
    offset: { type: 'number', description: '偏移量（默认 0）', required: false },
    sort_by: {
      type: 'string', description: '排序字段（默认 created_at）',
      enum: ['priority', 'created_at', 'updated_at', 'progress'], required: false,
    },
    sort_dir: { type: 'string', description: '排序方向（默认 desc）', enum: ['asc', 'desc'], required: false },
  },
}

export async function taskQuery(
  manager: TaskManager,
  params: Record<string, any>,
): Promise<ToolResult<unknown>> {
  const start = Date.now()
  try {
    const mode = params.mode ?? 'list'

    if (mode === 'detail') {
      if (!params.task_id) {
        return { success: false, error: 'mode=detail 需要 task_id 参数', duration: Date.now() - start }
      }
      const task = manager.getById(params.task_id)
      if (!task) {
        return { success: false, error: `任务 ${params.task_id} 不存在`, duration: Date.now() - start }
      }
      return { success: true, data: { task }, duration: Date.now() - start }
    }

    if (mode === 'progress') {
      if (!params.task_id) {
        return { success: false, error: 'mode=progress 需要 task_id 参数', duration: Date.now() - start }
      }
      const progress = manager.getProgress(params.task_id)
      return { success: true, data: { task_id: params.task_id, ...progress }, duration: Date.now() - start }
    }

    // list 模式
    const filter = params.filter ?? {}
    const result = manager.query({
      status: filter.status,
      priority: filter.priority,
      type: filter.type,
      tags: filter.tags,
      workspaceId: filter.workspace_id,
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
