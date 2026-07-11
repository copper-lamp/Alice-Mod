/**
 * task_control — 任务控制工具（暂停/恢复/取消/重试）
 */

import type { ToolSchema, ToolResult } from '@mcagent/shared'
import { ToolCategory } from '@mcagent/shared'
import type { TaskManager } from '../task-manager'

export const TASK_CONTROL_TOOL: ToolSchema = {
  name: 'task_control',
  description: '控制任务状态：pause=暂停, resume=恢复, cancel=取消, retry=重试',
  category: ToolCategory.Task,
  parameters: {
    task_id: { type: 'string', description: '任务 ID', required: true },
    action: { type: 'string', description: '控制动作', enum: ['pause', 'resume', 'cancel', 'retry'], required: true },
    reason: { type: 'string', description: '取消原因（action=cancel 时可选）', required: false },
    force: { type: 'boolean', description: '是否强制重试（action=retry 时可选）', required: false },
  },
}

export async function taskControl(
  manager: TaskManager,
  params: { task_id: string; action: string; reason?: string; force?: boolean },
): Promise<ToolResult<void>> {
  const start = Date.now()
  try {
    switch (params.action) {
      case 'pause':
        await manager.pause(params.task_id)
        break
      case 'resume':
        await manager.resume(params.task_id)
        break
      case 'cancel':
        await manager.cancel(params.task_id, params.reason)
        break
      case 'retry':
        await manager.retry(params.task_id, params.force)
        break
      default:
        return { success: false, error: `未知控制动作: ${params.action}`, duration: Date.now() - start }
    }
    return { success: true, duration: Date.now() - start }
  } catch (err) {
    return { success: false, error: `控制失败: ${(err as Error).message}`, duration: Date.now() - start }
  }
}