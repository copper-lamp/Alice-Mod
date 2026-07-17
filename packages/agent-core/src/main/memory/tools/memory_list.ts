/**
 * memory_list — 记忆列表工具
 *
 * 列出所有记忆，支持按类型过滤和分页。
 * 记忆类型简化为 3 种：event（事件）/character（人物）/experience（经验）
 */

import type { ToolSchema, ToolResult } from '@mcagent/shared';
import { ToolCategory } from '@mcagent/shared';
import type { MemoryManager } from '../memory-manager';

// ════════════════════════════════════════════════════════════════
// Schema
// ════════════════════════════════════════════════════════════════

export const MEMORY_LIST_TOOL: ToolSchema = {
  name: 'memory_list',
  description: '列出所有记忆，支持按类型过滤和标签过滤。记忆类型：event=事件, character=人物, experience=经验',
  category: ToolCategory.Memory,
  parameters: {
    type: {
      type: 'string',
      description: '过滤类型：event（事件）| character（人物）| experience（经验），不传则列出全部',
      required: false,
    },
    tags: {
      type: 'array',
      description: '标签过滤（AND 逻辑），仅返回包含所有指定标签的记忆',
      required: false,
      items: { type: 'string' },
    },
    limit: {
      type: 'number',
      description: '返回数量上限，默认 20',
      required: false,
      default: 20,
    },
    offset: {
      type: 'number',
      description: '分页偏移量，默认 0',
      required: false,
      default: 0,
    },
  },
};

// ════════════════════════════════════════════════════════════════
// 执行函数
// ════════════════════════════════════════════════════════════════

export async function memoryList(
  manager: MemoryManager,
  params: {
    type?: string;
    tags?: string[];
    limit?: number;
    offset?: number;
  },
  workspaceId?: string,
): Promise<ToolResult<{ memories: Array<{
  id: string;
  type: string;
  name: string;
  content: string;
  tags: string[];
  importance: number;
  createdAt: number;
  updatedAt: number;
}>; total: number }>> {
  const start = Date.now();
  try {
    const result = await manager.list({
      type: params.type as any,
      tags: params.tags,
      limit: params.limit ?? 20,
      offset: params.offset ?? 0,
      workspaceId,
    });

    const memories = result.memories.map(m => ({
      id: m.id,
      type: m.type,
      name: (m.content as any)?.name as string ?? '',
      content: (m.content as any)?.text as string ?? '',
      tags: m.tags,
      importance: m.importance,
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
    }));

    return {
      success: true,
      data: { memories, total: result.total },
      duration: Date.now() - start,
    };
  } catch (err) {
    return {
      success: false,
      error: `记忆列表查询失败: ${(err as Error).message}`,
      duration: Date.now() - start,
    };
  }
}