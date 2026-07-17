/**
 * 记忆工具 — 模块入口
 *
 * 导出所有 v2.0 工具 Schema + 执行函数。
 *
 * v2.0 工具分类（5 类 10 个工具）：
 *   1. memory_list    — 记忆列表
 *   2. memory_query   — 记忆搜索
 *   3. memory_edit    — 记忆编辑（create/update/delete 三合一）
 *   4. maps_query     — 地图路径点搜索
 *   5. maps_edit      — 地图路径点编辑（create/update/delete 三合一）
 *   6. aim_list       — 目标任务列表
 *   7. aim_query      — 目标任务详情
 *   8. aim_update     — 目标任务进度更新
 *   9. knowledge_query — 知识库查询
 *  10. tool_skill     — 技能加载（由 SkillInjector 自动注入，无独立工具）
 *
 * 保留 v1.0 旧工具导出（向后兼容，避免 adapter 编译报错）。
 */

import type { ToolSchema, ToolResult } from '@mcagent/shared';

// v2.0 新工具
import { MEMORY_LIST_TOOL, memoryList } from './memory_list';
import { MEMORY_QUERY_TOOL, memoryQuery } from './memory_query';
import { MEMORY_EDIT_TOOL, memoryEdit } from './memory_edit';
import { MAPS_QUERY_TOOL, mapsQuery } from './maps_query';
import { MAPS_EDIT_TOOL, mapsEdit } from './maps_edit';
import { AIM_LIST_TOOL, aimList } from './aim_list';
import { AIM_QUERY_TOOL, aimQuery } from './aim_query';
import { AIM_UPDATE_TOOL, aimUpdate } from './aim_update';
import { KNOWLEDGE_QUERY_TOOL, knowledgeQuery } from './knowledge_query';

// v1.0 旧工具（向后兼容）
import { MEMORY_STORE_TOOL, MEMORY_BATCH_STORE_TOOL, memoryStore, memoryBatchStore } from './memory_store';
import { MEMORY_RECALL_TOOL, memoryRecall } from './memory_recall';
import { MEMORY_UPDATE_TOOL, MEMORY_FORGET_TOOL, memoryUpdate, memoryForget } from './memory_update';
import { MEMORY_TAG_TOOL, MEMORY_UNTAG_TOOL, memoryTag, memoryUntag } from './memory_tag';
import { MEMORY_STATS_TOOL, MEMORY_CLEANUP_TOOL, MEMORY_EXPORT_TOOL, MEMORY_IMPORT_TOOL, memoryStats, memoryCleanup, memoryExport, memoryImport } from './memory_manage';
import { MAP_QUERY_NEARBY_TOOL, MAP_GET_OVERVIEW_TOOL, mapQueryNearby, mapGetOverview } from './map_tools';

export type { ToolSchema, ToolResult };

// ── v2.0 新工具导出 ──
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

// ── v1.0 旧工具导出（向后兼容） ──
export {
  MEMORY_STORE_TOOL, MEMORY_BATCH_STORE_TOOL, MEMORY_RECALL_TOOL, MEMORY_UPDATE_TOOL, MEMORY_FORGET_TOOL,
  MEMORY_TAG_TOOL, MEMORY_UNTAG_TOOL, MEMORY_STATS_TOOL, MEMORY_CLEANUP_TOOL, MEMORY_EXPORT_TOOL, MEMORY_IMPORT_TOOL,
  MAP_QUERY_NEARBY_TOOL, MAP_GET_OVERVIEW_TOOL,
};
export {
  memoryStore, memoryBatchStore, memoryRecall, memoryUpdate, memoryForget,
  memoryTag, memoryUntag, memoryStats, memoryCleanup, memoryExport, memoryImport,
  mapQueryNearby, mapGetOverview,
};

/** 所有工具的 Schema 列表（v2.0 新工具 + v1.0 旧工具，供注册到 ToolRegistry） */
export const MEMORY_TOOL_SCHEMAS: ToolSchema[] = [
  // v2.0 新工具
  MEMORY_LIST_TOOL,
  MEMORY_QUERY_TOOL,
  MEMORY_EDIT_TOOL,
  MAPS_QUERY_TOOL,
  MAPS_EDIT_TOOL,
  AIM_LIST_TOOL,
  AIM_QUERY_TOOL,
  AIM_UPDATE_TOOL,
  KNOWLEDGE_QUERY_TOOL,
  // v1.0 旧工具（向后兼容）
  MEMORY_STORE_TOOL,
  MEMORY_BATCH_STORE_TOOL,
  MEMORY_RECALL_TOOL,
  MEMORY_UPDATE_TOOL,
  MEMORY_FORGET_TOOL,
  MEMORY_TAG_TOOL,
  MEMORY_UNTAG_TOOL,
  MEMORY_STATS_TOOL,
  MEMORY_CLEANUP_TOOL,
  MEMORY_EXPORT_TOOL,
  MEMORY_IMPORT_TOOL,
  MAP_QUERY_NEARBY_TOOL,
  MAP_GET_OVERVIEW_TOOL,
];