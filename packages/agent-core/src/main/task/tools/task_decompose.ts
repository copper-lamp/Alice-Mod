/**
 * task_decompose — 任务分解工具（LLM 辅助）
 */

import type { ToolSchema, ToolResult } from '@mcagent/shared'
import { ToolCategory } from '@mcagent/shared'
import type { TaskManager } from '../task-manager'

export const TASK_DECOMPOSE_TOOL: ToolSchema = {
  name: 'task_decompose',
  description: '将复杂任务描述分解为一系列子任务，含依赖关系。LLM 辅助生成子任务列表',
  category: ToolCategory.Task,
  parameters: {
    task_description: { type: 'string', description: '要分解的任务描述', required: true },
    context: { type: 'object', description: '上下文信息（当前资源、位置等）', required: false },
    max_subtasks: { type: 'number', description: '最多分解多少个子任务（默认 10，防止过度拆分）', required: false },
    strategy: {
      type: 'string', description: '分解策略（默认 sequential）',
      enum: ['sequential', 'parallel', 'mixed'], required: false,
    },
  },
}

export async function taskDecompose(
  manager: TaskManager,
  params: { task_description: string; context?: Record<string, any>; max_subtasks?: number; strategy?: string },
): Promise<ToolResult<unknown>> {
  const start = Date.now()
  try {
    const result = await manager.decompose({
      taskDescription: params.task_description,
      context: params.context,
      maxSubtasks: params.max_subtasks,
      strategy: params.strategy as 'sequential' | 'parallel' | 'mixed' | undefined,
    })
    return { success: true, data: result, duration: Date.now() - start }
  } catch (err) {
    return { success: false, error: `任务分解失败: ${(err as Error).message}`, duration: Date.now() - start }
  }
}