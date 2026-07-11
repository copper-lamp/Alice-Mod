/**
 * memory_update — 记忆更新与删除工具
 *
 * 支持更新记忆内容/标签/重要度，以及删除指定记忆。
 */

import type { ToolSchema, ToolResult } from '@mcagent/shared';
import { ToolCategory } from '@mcagent/shared';
import type { MemoryManager } from '../memory-manager';

// ════════════════════════════════════════════════════════════════
// Schema
// ════════════════════════════════════════════════════════════════

export const MEMORY_UPDATE_TOOL: ToolSchema = {
  name: 'memory_update',
  description: '更新指定记忆的内容、标签、重要度等字段。内容变更时会自动重新生成向量嵌入',
  category: ToolCategory.Memory,
  parameters: {
    id: {
      type: 'string',
      description: '要更新的记忆 ID',
      required: true,
    },
    content: {
      type: 'object',
      description: '新的记忆内容（可选，传入时自动重新生成向量）',
      required: false,
    },
    tags: {
      type: 'array',
      description: '新的标签列表（可选，全量替换）',
      required: false,
    },
    importance: {
      type: 'number',
      description: '新的重要度（可选），范围 1-10',
      required: false,
    },
    expiresAt: {
      type: 'number',
      description: '新的过期时间戳（可选），null 表示永不过期',
      required: false,
    },
    branch: {
      type: 'string',
      description: '新的记忆分支（可选）',
      required: false,
    },
  },
};

export const MEMORY_FORGET_TOOL: ToolSchema = {
  name: 'memory_forget',
  description: '删除指定记忆（同时删除 SQLite 元数据和 Chroma 向量）',
  category: ToolCategory.Memory,
  parameters: {
    id: {
      type: 'string',
      description: '要删除的记忆 ID',
      required: true,
    },
  },
};

// ════════════════════════════════════════════════════════════════
// 执行函数
// ════════════════════════════════════════════════════════════════

export async function memoryUpdate(
  manager: MemoryManager,
  params: { id: string; content?: Record<string, unknown>; tags?: string[]; importance?: number; expiresAt?: number | null; branch?: string },
): Promise<ToolResult<null>> {
  const start = Date.now();
  try {
    await manager.update(params.id, {
      content: params.content,
      tags: params.tags,
      importance: params.importance,
      expiresAt: params.expiresAt,
      branch: params.branch as any,
    });
    return {
      success: true,
      data: null,
      duration: Date.now() - start,
    };
  } catch (err) {
    return {
      success: false,
      error: `记忆更新失败: ${(err as Error).message}`,
      duration: Date.now() - start,
    };
  }
}

export async function memoryForget(
  manager: MemoryManager,
  params: { id: string },
): Promise<ToolResult<null>> {
  const start = Date.now();
  try {
    await manager.forget(params.id);
    return {
      success: true,
      data: null,
      duration: Date.now() - start,
    };
  } catch (err) {
    return {
      success: false,
      error: `记忆删除失败: ${(err as Error).message}`,
      duration: Date.now() - start,
    };
  }
}