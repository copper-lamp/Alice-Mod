/**
 * V13 任务系统 — 模块入口
 *
 * 导出所有类型定义、接口和实现。
 */

export * from './types'
import { TaskManager } from './task-manager'
export { TaskManager }
export { TaskScheduler } from './task-scheduler'
export type { TaskSchedulerEvents } from './task-scheduler'
export { TimeoutManager } from './timeout-manager'
export { TaskExecutor } from './executors'
export { SimpleTaskExecutor } from './executors/simple-executor'
export { CompositeTaskExecutor } from './executors/composite-executor'
export { LoopTaskExecutor } from './executors/loop-executor'
export { ConditionalTaskExecutor } from './executors/conditional-executor'
export { TASK_TOOL_SCHEMAS } from './tools'

// ════════════════════════════════════════════════════════════════
// 全局 TaskManager 访问器（供 pipeline middleware 使用）
// ════════════════════════════════════════════════════════════════

let taskManagerInstance: TaskManager | null = null

export function setTaskManager(manager: TaskManager): void {
  taskManagerInstance = manager
}

export function getTaskManager(): TaskManager | null {
  return taskManagerInstance
}