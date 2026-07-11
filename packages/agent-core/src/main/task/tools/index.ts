/**
 * 任务工具 — 模块入口
 *
 * 导出所有任务工具 Schema 和执行函数。
 * 注册共 20 个工具（按功能分组）：
 * 1. task_create / task_batch_create
 * 2. task_query / task_get_by_id / task_get_progress / task_list
 * 3. task_update
 * 4. task_control (pause/resume/cancel/retry)
 * 5. task_decompose
 * 6. task_stats / task_cleanup / task_export / task_import
 * 7. task_set_priority / task_add_dependency / task_remove_dependency / task_schedule / task_queue_status
 */

import type { ToolSchema, ToolResult } from '@mcagent/shared'
import { TASK_CREATE_TOOL, TASK_BATCH_CREATE_TOOL, taskCreate, taskBatchCreate } from './task_create'
import { TASK_QUERY_TOOL, TASK_GET_BY_ID_TOOL, TASK_GET_PROGRESS_TOOL, TASK_LIST_TOOL, taskQuery, taskGetById, taskGetProgress, taskList } from './task_query'
import { TASK_UPDATE_TOOL, taskUpdate } from './task_update'
import { TASK_CONTROL_TOOL, taskControl } from './task_control'
import { TASK_DECOMPOSE_TOOL, taskDecompose } from './task_decompose'
import {
  TASK_STATS_TOOL, TASK_CLEANUP_TOOL, TASK_EXPORT_TOOL, TASK_IMPORT_TOOL,
  TASK_SET_PRIORITY_TOOL, TASK_ADD_DEPENDENCY_TOOL, TASK_REMOVE_DEPENDENCY_TOOL,
  TASK_SCHEDULE_TOOL, TASK_QUEUE_STATUS_TOOL,
  taskStats, taskCleanup, taskExport, taskImport,
  taskSetPriority, taskAddDependency, taskRemoveDependency,
  taskSchedule, taskQueueStatus,
} from './task_manage'

export type { ToolSchema, ToolResult }
export {
  TASK_CREATE_TOOL, TASK_BATCH_CREATE_TOOL,
  TASK_QUERY_TOOL, TASK_GET_BY_ID_TOOL, TASK_GET_PROGRESS_TOOL, TASK_LIST_TOOL,
  TASK_UPDATE_TOOL,
  TASK_CONTROL_TOOL,
  TASK_DECOMPOSE_TOOL,
  TASK_STATS_TOOL, TASK_CLEANUP_TOOL, TASK_EXPORT_TOOL, TASK_IMPORT_TOOL,
  TASK_SET_PRIORITY_TOOL, TASK_ADD_DEPENDENCY_TOOL, TASK_REMOVE_DEPENDENCY_TOOL,
  TASK_SCHEDULE_TOOL, TASK_QUEUE_STATUS_TOOL,
}
export {
  taskCreate, taskBatchCreate,
  taskQuery, taskGetById, taskGetProgress, taskList,
  taskUpdate,
  taskControl,
  taskDecompose,
  taskStats, taskCleanup, taskExport, taskImport,
  taskSetPriority, taskAddDependency, taskRemoveDependency,
  taskSchedule, taskQueueStatus,
}

/** 所有任务工具的 Schema 列表（用于注册到 ToolRegistry） */
export const TASK_TOOL_SCHEMAS: ToolSchema[] = [
  TASK_CREATE_TOOL,
  TASK_BATCH_CREATE_TOOL,
  TASK_QUERY_TOOL,
  TASK_GET_BY_ID_TOOL,
  TASK_GET_PROGRESS_TOOL,
  TASK_LIST_TOOL,
  TASK_UPDATE_TOOL,
  TASK_CONTROL_TOOL,
  TASK_DECOMPOSE_TOOL,
  TASK_STATS_TOOL,
  TASK_CLEANUP_TOOL,
  TASK_EXPORT_TOOL,
  TASK_IMPORT_TOOL,
  TASK_SET_PRIORITY_TOOL,
  TASK_ADD_DEPENDENCY_TOOL,
  TASK_REMOVE_DEPENDENCY_TOOL,
  TASK_SCHEDULE_TOOL,
  TASK_QUEUE_STATUS_TOOL,
]