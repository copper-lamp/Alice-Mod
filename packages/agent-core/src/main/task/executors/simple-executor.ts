/**
 * SimpleTaskExecutor — 简单任务执行器
 *
 * 执行一个单次工具调用。
 * 是四种执行器中最基础的一种。
 */

import type { Task, ExecutionContext, TaskResult } from '../types'

export class SimpleTaskExecutor {
  async execute(task: Task, context: ExecutionContext): Promise<TaskResult> {
    const start = Date.now()

    // 校验 action 存在
    if (!task.action) {
      return {
        success: false,
        error: '简单任务必须指定 action',
        durationMs: Date.now() - start,
      }
    }

    try {
      // 检查是否已中止
      if (context.abortSignal?.aborted) {
        return {
          success: false,
          error: '任务已中止',
          durationMs: Date.now() - start,
        }
      }

      // 更新进度为 50%（表示正在执行）
      await context.updateProgress(task.id, 50)

      // 调用工具
      const result = await context.callTool(task.action.toolName, task.action.parameters)

      // 更新进度为 100%
      await context.updateProgress(task.id, 100)

      return {
        success: true,
        data: result,
        durationMs: Date.now() - start,
      }
    } catch (err) {
      return {
        success: false,
        error: `工具调用失败: ${(err as Error).message}`,
        durationMs: Date.now() - start,
      }
    }
  }

  async canExecute(task: Task): Promise<{ ok: boolean; reason?: string }> {
    if (!task.action) {
      return { ok: false, reason: '简单任务必须指定 action' }
    }
    if (!task.action.toolName) {
      return { ok: false, reason: 'action 必须指定 toolName' }
    }
    return { ok: true }
  }

  async estimateDuration(task: Task): Promise<number> {
    return 5000 // 默认 5 秒
  }
}