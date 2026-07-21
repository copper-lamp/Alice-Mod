/**
 * 记忆工具 — 模块入口
 *
 * 导出所有 v2.0 工具 Schema + 执行函数。
 *
 * v2.0 工具（5 类 9 个工具）：
 *   1. knowledge_query — 知识库查询
 *   2. memory_list    — 记忆列表
 *   3. memory_query   — 记忆搜索
 *   4. memory_edit    — 记忆编辑（create/update/delete 三合一）
 *   5. maps_query     — 地图路径点搜索
 *   6. maps_edit      — 地图路径点编辑（create/update/delete 三合一）
 *   7. aim_list       — 目标任务列表
 *   8. aim_query      — 目标任务详情
 *   9. aim_update     — 目标任务进度更新
 */

import type { ToolSchema, ToolResult } from '@mcagent/shared';

// v2.0 工具
import { MEMORY_LIST_TOOL, memoryList } from './memory_list';
import { MEMORY_QUERY_TOOL, memoryQuery } from './memory_query';
import { MEMORY_EDIT_TOOL, memoryEdit } from './memory_edit';
import { MAPS_QUERY_TOOL, mapsQuery } from './maps_query';
import { MAPS_EDIT_TOOL, mapsEdit } from './maps_edit';
import { AIM_LIST_TOOL, aimList } from './aim_list';
import { AIM_QUERY_TOOL, aimQuery } from './aim_query';
import { AIM_UPDATE_TOOL, aimUpdate } from './aim_update';
import { KNOWLEDGE_QUERY_TOOL, knowledgeQuery } from './knowledge_query';

export type { ToolSchema, ToolResult };

export {
  MEMORY_LIST_TOOL, MEMORY_QUERY_TOOL, MEMORY_EDIT_TOOL,
  MAPS_QUERY_TOOL, MAPS_EDIT_TOOL,
  AIM_LIST_TOOL, AIM_QUERY_TOOL, AIM_UPDATE_TOOL,
  KNOWLEDGE_QUERY_TOOL,
};
export {
  memoryList, memoryQuery, memoryEdit,
  mapsQuery, mapsEdit,
  aimList, aimQuery, aimUpdate,
  knowledgeQuery,
};

/** 所有工具的 Schema 列表（v2.0，供注册到 ToolRegistry） */
export const MEMORY_TOOL_SCHEMAS: ToolSchema[] = [
  MEMORY_LIST_TOOL,
  MEMORY_QUERY_TOOL,
  MEMORY_EDIT_TOOL,
  MAPS_QUERY_TOOL,
  MAPS_EDIT_TOOL,
  AIM_LIST_TOOL,
  AIM_QUERY_TOOL,
  AIM_UPDATE_TOOL,
  KNOWLEDGE_QUERY_TOOL,
];