/**
 * TaskExecutor — 任务执行器统一入口
 *
 * 按任务类型分发到对应的执行器。
 * 策略模式：Simple / Composite / Loop / Conditional
 */

import type { Task, ExecutionContext, TaskResult } from '../types'
import { SimpleTaskExecutor } from './simple-executor'
import { CompositeTaskExecutor } from './composite-executor'
import { LoopTaskExecutor } from './loop-executor'
import { ConditionalTaskExecutor } from './conditional-executor'

export type { ExecutionContext, TaskResult } from '../types'

export class TaskExecutor {
  private simple: SimpleTaskExecutor
  private composite: CompositeTaskExecutor
  private loop: LoopTaskExecutor
  private conditional: ConditionalTaskExecutor

  constructor() {
    this.simple = new SimpleTaskExecutor()
    this.composite = new CompositeTaskExecutor()
    this.loop = new LoopTaskExecutor()
    this.conditional = new ConditionalTaskExecutor()
  }

  async execute(task: Task, context: ExecutionContext): Promise<TaskResult> {
    switch (task.type) {
      case 'simple':
        return this.simple.execute(task, context)
      case 'composite':
        return this.composite.execute(task, context)
      case 'loop':
        return this.loop.execute(task, context)
      case 'conditional':
        return this.conditional.execute(task, context)
      default:
        return {
          success: false,
          error: `未知任务类型: ${(task as any).type}`,
          durationMs: 0,
        }
    }
  }

  async canExecute(task: Task): Promise<{ ok: boolean; reason?: string }> {
    switch (task.type) {
      case 'simple':
        return this.simple.canExecute(task)
      case 'composite':
        return this.composite.canExecute(task)
      case 'loop':
        return this.loop.canExecute(task)
      case 'conditional':
        return this.conditional.canExecute(task)
      default:
        return { ok: false, reason: `未知任务类型: ${(task as any).type}` }
    }
  }

  async estimateDuration(task: Task): Promise<number> {
    switch (task.type) {
      case 'simple':
        return this.simple.estimateDuration(task)
      case 'composite':
        return this.composite.estimateDuration(task)
      case 'loop':
        return this.loop.estimateDuration(task)
      case 'conditional':
        return this.conditional.estimateDuration(task)
      default:
        return 30000
    }
  }
}