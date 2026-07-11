/**
 * 记忆工具 — 模块入口
 *
 * 导出所有 8 个记忆工具（2 存储 + 1 检索 + 2 更新删除 + 2 标签 + 4 管理 = 11 个 Schema）
 *
 * 实际注册的 8 个工具（按功能合并）：
 * 1. memory_store       — 存储单条记忆
 * 2. memory_batch_store — 批量存储记忆
 * 3. memory_recall      — 检索记忆（ID/条件/语义）
 * 4. memory_update      — 更新记忆
 * 5. memory_forget      — 删除记忆
 * 6. memory_tag         — 添加标签
 * 7. memory_untag       — 移除标签
 * 8. memory_manage      — 管理（stats/cleanup/export/import）
 */

import type { ToolSchema, ToolResult } from '@mcagent/shared';
import { MEMORY_STORE_TOOL, MEMORY_BATCH_STORE_TOOL, memoryStore, memoryBatchStore } from './memory_store';
import { MEMORY_RECALL_TOOL, memoryRecall } from './memory_recall';
import { MEMORY_UPDATE_TOOL, MEMORY_FORGET_TOOL, memoryUpdate, memoryForget } from './memory_update';
import { MEMORY_TAG_TOOL, MEMORY_UNTAG_TOOL, memoryTag, memoryUntag } from './memory_tag';
import { MEMORY_STATS_TOOL, MEMORY_CLEANUP_TOOL, MEMORY_EXPORT_TOOL, MEMORY_IMPORT_TOOL, memoryStats, memoryCleanup, memoryExport, memoryImport } from './memory_manage';
import { MAP_QUERY_NEARBY_TOOL, MAP_GET_OVERVIEW_TOOL, mapQueryNearby, mapGetOverview } from './map_tools';
export type { ToolSchema, ToolResult };
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

/** 所有记忆工具的 Schema 列表（用于注册到 ToolRegistry） */
export const MEMORY_TOOL_SCHEMAS: ToolSchema[] = [
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