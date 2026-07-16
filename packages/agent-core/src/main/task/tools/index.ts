/**
 * 任务工具 — 模块入口
 *
 * v2.0：从 20 个工具收敛为 6 个：
 * 1. task_create     — 创建（单条 + 批量合一）
 * 2. task_query      — 查询（detail / progress / list 三模式）
 * 3. task_update     — 更新属性（补 metadata / retry_config）
 * 4. task_control    — 暂停/恢复/取消/重试
 * 5. task_decompose  — LLM 分解复杂任务
 * 6. task_manage     — 9 action 合并（stats/cleanup/export/import/priority/add_dep/remove_dep/schedule/queue_status）
 */

import type { ToolSchema, ToolResult } from '@mcagent/shared'
import { TASK_CREATE_TOOL, taskCreate } from './task_create'
import { TASK_QUERY_TOOL, taskQuery } from './task_query'
import { TASK_UPDATE_TOOL, taskUpdate } from './task_update'
import { TASK_CONTROL_TOOL, taskControl } from './task_control'
import { TASK_DECOMPOSE_TOOL, taskDecompose } from './task_decompose'
import { TASK_MANAGE_TOOL, taskManage } from './task_manage'

export type { ToolSchema, ToolResult }
export {
  TASK_CREATE_TOOL,
  TASK_QUERY_TOOL,
  TASK_UPDATE_TOOL,
  TASK_CONTROL_TOOL,
  TASK_DECOMPOSE_TOOL,
  TASK_MANAGE_TOOL,
}
export {
  taskCreate,
  taskQuery,
  taskUpdate,
  taskControl,
  taskDecompose,
  taskManage,
}

/** 所有任务工具的 Schema 列表（用于注册到 ToolRegistry） */
export const TASK_TOOL_SCHEMAS: ToolSchema[] = [
  TASK_CREATE_TOOL,
  TASK_QUERY_TOOL,
  TASK_UPDATE_TOOL,
  TASK_CONTROL_TOOL,
  TASK_DECOMPOSE_TOOL,
  TASK_MANAGE_TOOL,
]
