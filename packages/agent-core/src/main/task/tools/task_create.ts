/**
 * task_create / task_batch_create — 任务创建工具
 */

import type { ToolSchema, ToolResult } from '@mcagent/shared'
import { ToolCategory } from '@mcagent/shared'
import type { TaskManager } from '../task-manager'

export const TASK_CREATE_TOOL: ToolSchema = {
  name: 'task_create',
  description: '创建一个新任务，支持 4 种类型：simple=简单工具调用, composite=复合子任务, loop=循环执行, conditional=条件触发',
  category: ToolCategory.Task,
  parameters: {
    name: { type: 'string', description: '任务名称', required: true },
    description: { type: 'string', description: '任务描述', required: false },
    type: {
      type: 'string', description: '任务类型', required: true,
      enum: ['simple', 'composite', 'loop', 'conditional'],
    },
    action: { type: 'object', description: '简单/循环/条件任务需要指定调用的工具和参数（{toolName, parameters}）', required: false },
    subtask_ids: { type: 'array', description: '复合任务的子任务 ID 列表', required: false },
    loop_config: { type: 'object', description: '循环任务的配置（{mode, count?, interval?, condition?, maxIterations}）', required: false },
    condition: { type: 'object', description: '条件任务的触发条件（{type, value, description?}）', required: false },
    priority: { type: 'string', description: '优先级（默认 normal）', enum: ['critical', 'high', 'normal', 'low'], required: false },
    dependencies: { type: 'array', description: '依赖的任务 ID 列表', required: false },
    timeout: { type: 'number', description: '超时时间（秒，默认 300）', required: false },
    tags: { type: 'array', description: '标签', required: false },
  },
}

export const TASK_BATCH_CREATE_TOOL: ToolSchema = {
  name: 'task_batch_create',
  description: '批量创建多个任务，比逐条创建更高效',
  category: ToolCategory.Task,
  parameters: {
    tasks: { type: 'array', description: '任务列表，每条包含 name/type/action 等字段', required: true },
  },
}

export async function taskCreate(
  manager: TaskManager,
  params: Record<string, any>,
  workspaceId?: string,
): Promise<ToolResult<{ id: string; createdAt: number }>> {
  const start = Date.now()
  try {
    const result = await manager.create({
      workspaceId: workspaceId ?? 'default',
      name: params.name,
      description: params.description,
      type: params.type,
      action: params.action,
      subtaskIds: params.subtask_ids,
      loopConfig: params.loop_config,
      condition: params.condition,
      priority: params.priority,
      dependencies: params.dependencies,
      timeout: params.timeout,
      tags: params.tags,
    })
    return { success: true, data: result, duration: Date.now() - start }
  } catch (err) {
    return { success: false, error: `任务创建失败: ${(err as Error).message}`, duration: Date.now() - start }
  }
}

export async function taskBatchCreate(
  manager: TaskManager,
  params: { tasks: Record<string, any>[] },
  workspaceId?: string,
): Promise<ToolResult<{ ids: string[]; count: number }>> {
  const start = Date.now()
  try {
    const result = await manager.batchCreate({
      tasks: params.tasks.map(p => ({
        workspaceId: workspaceId ?? 'default',
        name: p.name,
        description: p.description,
        type: p.type,
        action: p.action,
        subtaskIds: p.subtask_ids,
        loopConfig: p.loop_config,
        condition: p.condition,
        priority: p.priority,
        dependencies: p.dependencies,
        timeout: p.timeout,
        tags: p.tags,
      })),
    })
    return { success: true, data: result, duration: Date.now() - start }
  } catch (err) {
    return { success: false, error: `批量创建失败: ${(err as Error).message}`, duration: Date.now() - start }
  }
}