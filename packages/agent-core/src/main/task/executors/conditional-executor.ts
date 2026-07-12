/**
 * ConditionalTaskExecutor — 条件任务执行器
 *
 * 等待条件满足后执行一次 action。
 * 支持四种条件类型：
 * - time: 到达指定时间戳后执行
 * - event: 等待事件发生（V14 事件系统实现）
 * - state: 轮询检查状态（通过工具调用）
 * - expression: 轮询求值表达式
 */

import type { Task, ExecutionContext, TaskResult } from '../types'

export class ConditionalTaskExecutor {
  async execute(task: Task, context: ExecutionContext): Promise<TaskResult> {
    const start = Date.now()

    // 校验配置
    if (!task.condition) {
      return {
        success: false,
        error: '条件任务必须指定 condition',
        durationMs: Date.now() - start,
      }
    }

    if (!task.action) {
      return {
        success: false,
        error: '条件任务必须指定 action',
        durationMs: Date.now() - start,
      }
    }

    try {
      // 等待条件满足
      const conditionMet = await this.waitForCondition(task.condition, context)

      if (!conditionMet) {
        return {
          success: false,
          error: '条件未满足（超时或中止）',
          durationMs: Date.now() - start,
        }
      }

      // 检查中止
      if (context.abortSignal?.aborted) {
        return {
          success: false,
          error: '任务已中止',
          durationMs: Date.now() - start,
        }
      }

      // 更新进度为 50%
      await context.updateProgress(task.id, 50)

      // 执行 action
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
        error: `条件任务执行失败: ${(err as Error).message}`,
        durationMs: Date.now() - start,
      }
    }
  }

  /**
   * 等待条件满足
   */
  private async waitForCondition(
    condition: NonNullable<Task['condition']>,
    context: ExecutionContext,
  ): Promise<boolean> {
    switch (condition.type) {
      case 'time':
        return this.waitForTime(condition.value, context)

      case 'event':
        // V14 事件系统实现
        await context.log('', '事件条件等待（V14 实现）')
        return false

      case 'state':
        return this.waitForState(condition.value, context)

      case 'expression':
        return this.waitForExpression(condition.value, context)

      default:
        return false
    }
  }

  /**
   * time 条件：等待到指定时间戳
   */
  private async waitForTime(timestamp: number, context: ExecutionContext): Promise<boolean> {
    const now = Date.now()
    const delay = Math.max(0, timestamp - now)

    if (delay <= 0) return true // 时间已到

    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(true), delay)

      if (context.abortSignal) {
        const onAbort = () => {
          clearTimeout(timer)
          resolve(false)
        }
        context.abortSignal.addEventListener('abort', onAbort, { once: true })
      }
    })
  }

  /**
   * state 条件：轮询检查状态
   * value 格式: { toolName: string, parameters: object, check: (result) => boolean }
   */
  private async waitForState(
    value: any,
    context: ExecutionContext,
  ): Promise<boolean> {
    const maxRetries = 60 // 最多轮询 60 次（60 秒）
    const pollInterval = 1000 // 1 秒轮询一次

    for (let i = 0; i < maxRetries; i++) {
      if (context.abortSignal?.aborted) return false

      try {
        if (value && value.toolName) {
          const result = await context.callTool(value.toolName, value.parameters ?? {})
          if (value.check && value.check(result)) {
            return true
          }
        }
      } catch {
        // 轮询失败继续等待
      }

      await this.sleep(pollInterval, context)
    }

    return false
  }

  /**
   * expression 条件：轮询求值表达式
   */
  private async waitForExpression(
    expression: string,
    context: ExecutionContext,
  ): Promise<boolean> {
    const maxRetries = 60
    const pollInterval = 1000

    for (let i = 0; i < maxRetries; i++) {
      if (context.abortSignal?.aborted) return false

      try {
        // 简单表达式求值（true/false 字符串）
        if (expression === 'true') return true
        if (expression === 'false') return false
        // 更复杂的表达式由外部注入
        await context.log('', `表达式求值（外部实现）: ${expression}`)
        return false
      } catch {
        // 求值失败继续等待
      }

      await this.sleep(pollInterval, context)
    }

    return false
  }

  private sleep(ms: number, context: ExecutionContext): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms)
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
    if (!task.condition) {
      return { ok: false, reason: '条件任务必须指定 condition' }
    }
    if (!task.action) {
      return { ok: false, reason: '条件任务必须指定 action' }
    }
    return { ok: true }
  }

  async estimateDuration(task: Task): Promise<number> {
    if (task.condition?.type === 'time') {
      const delay = (task.condition.value as number) - Date.now()
      return Math.max(0, delay) + 5000
    }
    return 30000 // 默认 30 秒
  }
}