/**
 * memory_manage — 记忆管理工具
 *
 * 提供记忆系统统计、清理、导出、导入功能。
 */

import type { ToolSchema, ToolResult } from '@mcagent/shared';
import { ToolCategory } from '@mcagent/shared';
import type { MemoryManager } from '../memory-manager';

// ════════════════════════════════════════════════════════════════
// Schema
// ════════════════════════════════════════════════════════════════

export const MEMORY_STATS_TOOL: ToolSchema = {
  name: 'memory_stats',
  description: '查看记忆系统统计信息，包括总数、按类型/分支分布、平均重要度、未嵌入数等',
  category: ToolCategory.Memory,
  parameters: {
    workspaceId: {
      type: 'string',
      description: '工作区 ID（可选，默认当前工作区）',
      required: false,
    },
  },
};

export const MEMORY_CLEANUP_TOOL: ToolSchema = {
  name: 'memory_cleanup',
  description: '清理记忆。支持三种模式：expired=仅清理过期, low_importance=清理低重要度, all=完整清理（过期+低重要度+上限控制）',
  category: ToolCategory.Memory,
  parameters: {
    mode: {
      type: 'string',
      description: '清理模式：expired=仅过期, low_importance=仅低重要度, all=完整清理（默认）',
      required: false,
    },
    importanceThreshold: {
      type: 'number',
      description: '低重要度阈值（仅 mode=low_importance 时有效，默认 2）',
      required: false,
    },
  },
};

export const MEMORY_EXPORT_TOOL: ToolSchema = {
  name: 'memory_export',
  description: '导出记忆数据为 JSON 或 JSONL 格式',
  category: ToolCategory.Memory,
  parameters: {
    type: {
      type: 'string',
      description: '按记忆类型筛选导出（可选）',
      required: false,
    },
    format: {
      type: 'string',
      description: '导出格式：json=JSON 数组, jsonl=JSON Lines（默认 json）',
      required: false,
    },
  },
};

export const MEMORY_IMPORT_TOOL: ToolSchema = {
  name: 'memory_import',
  description: '从 JSON 或 JSONL 格式导入记忆数据',
  category: ToolCategory.Memory,
  parameters: {
    json: {
      type: 'string',
      description: 'JSON 或 JSONL 格式的记忆数据字符串',
      required: true,
    },
  },
};

// ════════════════════════════════════════════════════════════════
// 执行函数
// ════════════════════════════════════════════════════════════════

export async function memoryStats(
  manager: MemoryManager,
  workspaceId?: string,
): Promise<ToolResult<unknown>> {
  const start = Date.now();
  try {
    const result = await manager.stats(workspaceId);
    return {
      success: true,
      data: result,
      duration: Date.now() - start,
    };
  } catch (err) {
    return {
      success: false,
      error: `统计查询失败: ${(err as Error).message}`,
      duration: Date.now() - start,
    };
  }
}

export async function memoryCleanup(
  manager: MemoryManager,
  params: { mode?: string; importanceThreshold?: number },
): Promise<ToolResult<unknown>> {
  const start = Date.now();
  try {
    const result = await manager.cleanup({
      mode: (params.mode ?? 'all') as any,
      importanceThreshold: params.importanceThreshold,
    });
    return {
      success: true,
      data: result,
      duration: Date.now() - start,
    };
  } catch (err) {
    return {
      success: false,
      error: `清理失败: ${(err as Error).message}`,
      duration: Date.now() - start,
    };
  }
}

export async function memoryExport(
  manager: MemoryManager,
  params: { type?: string; format?: string },
): Promise<ToolResult<string>> {
  const start = Date.now();
  try {
    const result = await manager.export({
      type: params.type as any,
      format: params.format as any,
    });
    return {
      success: true,
      data: result,
      duration: Date.now() - start,
    };
  } catch (err) {
    return {
      success: false,
      error: `导出失败: ${(err as Error).message}`,
      duration: Date.now() - start,
    };
  }
}

export async function memoryImport(
  manager: MemoryManager,
  params: { json: string },
): Promise<ToolResult<unknown>> {
  const start = Date.now();
  try {
    const result = await manager.import(params.json);
    return {
      success: true,
      data: result,
      duration: Date.now() - start,
    };
  } catch (err) {
    return {
      success: false,
      error: `导入失败: ${(err as Error).message}`,
      duration: Date.now() - start,
    };
  }
}