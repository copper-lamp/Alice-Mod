/**
 * task_update — 任务更新工具
 */

import type { ToolSchema, ToolResult } from '@mcagent/shared'
import { ToolCategory } from '@mcagent/shared'
import type { TaskManager } from '../task-manager'

export const TASK_UPDATE_TOOL: ToolSchema = {
  name: 'task_update',
  description: '更新任务属性（名称/描述/优先级/超时/标签等）',
  category: ToolCategory.Task,
  parameters: {
    task_id: { type: 'string', description: '任务 ID', required: true },
    name: { type: 'string', description: '新名称', required: false },
    description: { type: 'string', description: '新描述', required: false },
    priority: { type: 'string', description: '新优先级', enum: ['critical', 'high', 'normal', 'low'], required: false },
    timeout: { type: 'number', description: '新超时时间（秒）', required: false },
    tags: { type: 'array', description: '新标签列表', required: false },
  },
}

export async function taskUpdate(
  manager: TaskManager,
  params: { task_id: string } & Record<string, any>,
): Promise<ToolResult<void>> {
  const start = Date.now()
  try {
    await manager.update(params.task_id, {
      name: params.name,
      description: params.description,
      priority: params.priority,
      timeout: params.timeout,
      tags: params.tags,
    })
    return { success: true, duration: Date.now() - start }
  } catch (err) {
    return { success: false, error: `更新失败: ${(err as Error).message}`, duration: Date.now() - start }
  }
}