/**
 * CompositeTaskExecutor — 复合任务执行器
 *
 * 按序执行子任务列表。
 * 子任务通过调度队列执行，等待全部完成后标记复合任务完成。
 */

import type { Task, ExecutionContext, TaskResult } from '../types'

export class CompositeTaskExecutor {
  async execute(task: Task, context: ExecutionContext): Promise<TaskResult> {
    const start = Date.now()

    // 校验 subtaskIds 存在
    if (!task.subtaskIds || task.subtaskIds.length === 0) {
      return {
        success: false,
        error: '复合任务必须指定 subtaskIds',
        durationMs: Date.now() - start,
      }
    }

    try {
      const total = task.subtaskIds.length
      let completedCount = 0
      let lastError: string | undefined

      for (let i = 0; i < total; i++) {
        // 检查是否已中止
        if (context.abortSignal?.aborted) {
          return {
            success: false,
            error: '任务已中止',
            durationMs: Date.now() - start,
          }
        }

        const subTaskId = task.subtaskIds[i]
        const subTask = await context.getSubTask(subTaskId)

        if (!subTask) {
          lastError = `子任务 ${subTaskId} 不存在`
          continue
        }

        // 更新进度
        const progress = Math.round(((i) / total) * 100)
        await context.updateProgress(task.id, progress)

        // 检查子任务状态
        if (subTask.status === 'completed') {
          completedCount++
          continue
        }

        if (subTask.status === 'failed') {
          lastError = `子任务 ${subTaskId} 已失败: ${subTask.error}`
          continue
        }

        // 子任务还未完成，等待（通过调度器自动执行）
        // 这里简化处理：直接返回等待状态
        await context.log(task.id, `等待子任务完成: ${subTaskId}`)
        return {
          success: false,
          error: `子任务 ${subTaskId} 尚未完成`,
          durationMs: Date.now() - start,
        }
      }

      // 更新进度为 100%
      await context.updateProgress(task.id, 100)

      if (completedCount === total) {
        return {
          success: true,
          data: { completedCount, total },
          durationMs: Date.now() - start,
        }
      }

      return {
        success: false,
        error: lastError ?? `部分子任务未完成 (${completedCount}/${total})`,
        durationMs: Date.now() - start,
      }
    } catch (err) {
      return {
        success: false,
        error: `复合任务执行失败: ${(err as Error).message}`,
        durationMs: Date.now() - start,
      }
    }
  }

  async canExecute(task: Task): Promise<{ ok: boolean; reason?: string }> {
    if (!task.subtaskIds || task.subtaskIds.length === 0) {
      return { ok: false, reason: '复合任务必须指定 subtaskIds' }
    }
    return { ok: true }
  }

  async estimateDuration(task: Task): Promise<number> {
    const subtaskCount = task.subtaskIds?.length ?? 0
    return subtaskCount * 10000 // 每个子任务估算 10 秒
  }
}