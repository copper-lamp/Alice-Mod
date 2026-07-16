/**
 * task_update — 任务更新工具
 *
 * v2.0：补回 metadata / retry_config 字段。
 * 注意：status / progress 由 task_control 或执行器维护，此处不开放。
 */

import type { ToolSchema, ToolResult } from '@mcagent/shared'
import { ToolCategory } from '@mcagent/shared'
import type { TaskManager } from '../task-manager'

export const TASK_UPDATE_TOOL: ToolSchema = {
  name: 'task_update',
  description: '更新任务属性（名称/描述/优先级/超时/重试配置/标签/元数据）。不修改 status 和 progress',
  category: ToolCategory.Task,
  parameters: {
    task_id: { type: 'string', description: '任务 ID', required: true },
    name: { type: 'string', description: '新名称', required: false },
    description: { type: 'string', description: '新描述', required: false },
    priority: {
      type: 'string', description: '新优先级',
      enum: ['critical', 'high', 'normal', 'low'], required: false,
    },
    timeout: { type: 'number', description: '新超时时间（秒）', required: false },
    retry_config: { type: 'object', description: '新重试配置 { maxRetries, retryDelay, backoffMultiplier? }', required: false },
    tags: { type: 'array', description: '新标签列表（整体替换）', required: false },
    metadata: { type: 'object', description: '新自定义元数据（整体替换）', required: false },
  },
}

export async function taskUpdate(
  manager: TaskManager,
  params: { task_id: string } & Record<string, any>,
): Promise<ToolResult<{ updated_fields: string[] }>> {
  const start = Date.now()
  try {
    const updates: Record<string, any> = {}
    const updatedFields: string[] = []

    if (params.name !== undefined) { updates.name = params.name; updatedFields.push('name') }
    if (params.description !== undefined) { updates.description = params.description; updatedFields.push('description') }
    if (params.priority !== undefined) { updates.priority = params.priority; updatedFields.push('priority') }
    if (params.timeout !== undefined) { updates.timeout = params.timeout; updatedFields.push('timeout') }
    if (params.retry_config !== undefined) { updates.retryConfig = params.retry_config; updatedFields.push('retry_config') }
    if (params.tags !== undefined) { updates.tags = params.tags; updatedFields.push('tags') }
    if (params.metadata !== undefined) { updates.metadata = params.metadata; updatedFields.push('metadata') }

    if (updatedFields.length === 0) {
      return { success: false, error: '未提供任何更新字段', duration: Date.now() - start }
    }

    await manager.update(params.task_id, updates)
    return { success: true, data: { updated_fields: updatedFields }, duration: Date.now() - start }
  } catch (err) {
    return { success: false, error: `更新失败: ${(err as Error).message}`, duration: Date.now() - start }
  }
}
