/**
 * LoopTaskExecutor — 循环任务执行器
 *
 * 支持三种循环模式：
 * - count: 执行指定次数后停止
 * - interval: 每间隔指定时间执行一次
 * - condition: 条件为 true 时执行，否则停止
 *
 * 强制上限 maxIterations 防止无限循环。
 */

import type { Task, ExecutionContext, TaskResult } from '../types'

export class LoopTaskExecutor {
  async execute(task: Task, context: ExecutionContext): Promise<TaskResult> {
    const start = Date.now()

    // 校验配置
    if (!task.loopConfig) {
      return {
        success: false,
        error: '循环任务必须指定 loopConfig',
        durationMs: Date.now() - start,
      }
    }

    if (!task.action) {
      return {
        success: false,
        error: '循环任务必须指定 action',
        durationMs: Date.now() - start,
      }
    }

    const loopConfig = task.loopConfig
    const maxIterations = loopConfig.maxIterations ?? 100
    let iteration = 0
    let lastResult: any = null
    let lastError: string | undefined

    try {
      while (iteration < maxIterations) {
        // 检查中止
        if (context.abortSignal?.aborted) {
          return {
            success: false,
            error: '任务已中止',
            durationMs: Date.now() - start,
          }
        }

        // 判断是否继续循环
        const shouldContinue = await this.shouldContinue(loopConfig, iteration, context)
        if (!shouldContinue) {
          break
        }

        // 执行 action
        try {
          lastResult = await context.callTool(task.action.toolName, task.action.parameters)
        } catch (err) {
          lastError = `第 ${iteration + 1} 次循环失败: ${(err as Error).message}`
          break
        }

        iteration++

        // 更新进度
        const progress = Math.min(Math.round((iteration / maxIterations) * 100), 100)
        await context.updateProgress(task.id, progress)

        // interval 模式：等待间隔
        if (loopConfig.mode === 'interval' && loopConfig.interval && iteration < maxIterations) {
          await this.sleep(loopConfig.interval * 1000, context)
        }

        // 如果 abortSignal 已被触发，中断
        if (context.abortSignal?.aborted) {
          break
        }
      }

      const durationMs = Date.now() - start

      if (lastError) {
        return {
          success: false,
          error: lastError,
          data: { iterations: iteration, lastResult },
          durationMs,
        }
      }

      return {
        success: true,
        data: {
          iterations: iteration,
          maxIterations,
          lastResult,
        },
        durationMs,
      }
    } catch (err) {
      return {
        success: false,
        error: `循环任务执行失败: ${(err as Error).message}`,
        durationMs: Date.now() - start,
      }
    }
  }

  private async shouldContinue(
    loopConfig: NonNullable<Task['loopConfig']>,
    iteration: number,
    context: ExecutionContext,
  ): Promise<boolean> {
    switch (loopConfig.mode) {
      case 'count':
        // count 模式：执行指定次数
        return iteration < (loopConfig.count ?? 1)

      case 'interval':
        // interval 模式：无上限时一直执行
        return true

      case 'condition':
        // condition 模式：评估条件表达式
        // 默认实现：始终返回 true，由外部通过取消来控制
        return true

      default:
        return false
    }
  }

  private sleep(ms: number, context: ExecutionContext): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms)
      // 如果 abortSignal 被触发，清除定时器
      if (context.abortSignal) {
        const onAbort = () => {
          clearTimeout(timer)
          resolve()
        }
        context.abortSignal.addEventListener('abort', onAbort, { once: true })
      }
    })
  }

  async canExecute(task: Task): Promise<{ ok: boolean; reason?: string }> {
    if (!task.loopConfig) {
      return { ok: false, reason: '循环任务必须指定 loopConfig' }
    }
    if (!task.action) {
      return { ok: false, reason: '循环任务必须指定 action' }
    }
    return { ok: true }
  }

  async estimateDuration(task: Task): Promise<number> {
    const count = task.loopConfig?.count ?? 10
    const interval = task.loopConfig?.interval ?? 0
    return count * (5000 + interval * 1000) // 每次执行 5 秒 + 间隔
  }
}