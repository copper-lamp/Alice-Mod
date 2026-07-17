/**
 * memory_query — 记忆搜索工具
 *
 * 按关键词或语义搜索记忆。支持类型过滤。
 * 语义搜索使用 Chroma 向量检索，关键词使用 SQLite LIKE 模糊搜索。
 */

import type { ToolSchema, ToolResult } from '@mcagent/shared';
import { ToolCategory } from '@mcagent/shared';
import type { MemoryManager } from '../memory-manager';

// ════════════════════════════════════════════════════════════════
// Schema
// ════════════════════════════════════════════════════════════════

export const MEMORY_QUERY_TOOL: ToolSchema = {
  name: 'memory_query',
  description: '按关键词或语义搜索记忆。keywords 在 content 中模糊匹配，query 使用语义向量检索（更精准）。支持类型过滤',
  category: ToolCategory.Memory,
  parameters: {
    keywords: {
      type: 'array',
      description: '关键词列表，在 content 中模糊搜索（多个关键词取 AND 逻辑）',
      required: false,
      items: { type: 'string' },
    },
    query: {
      type: 'string',
      description: '语义查询文本，使用向量检索（与 keywords 互斥，优先使用此参数）',
      required: false,
    },
    type: {
      type: 'string',
      description: '按类型过滤：event（事件）| character（人物）| experience（经验）',
      required: false,
    },
    limit: {
      type: 'number',
      description: '返回数量上限，默认 10',
      required: false,
      default: 10,
    },
  },
};

// ════════════════════════════════════════════════════════════════
// 执行函数
// ════════════════════════════════════════════════════════════════

export async function memoryQuery(
  manager: MemoryManager,
  params: {
    keywords?: string[];
    query?: string;
    type?: string;
    limit?: number;
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
    let memories: Array<any>;

    if (params.query) {
      // 语义检索
      const similarResult = await manager.getSimilar({
        query: params.query,
        type: params.type as any,
        workspaceId,
        limit: params.limit ?? 10,
        minScore: 0.5,
      });
      memories = similarResult.memories;
    } else {
      // 关键词检索
      const result = await manager.list({
        keywords: params.keywords,
        type: params.type as any,
        workspaceId,
        limit: params.limit ?? 10,
      });
      memories = result.memories;
    }

    const mapped = memories.map((m: any) => ({
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
      data: { memories: mapped, total: mapped.length },
      duration: Date.now() - start,
    };
  } catch (err) {
    return {
      success: false,
      error: `记忆搜索失败: ${(err as Error).message}`,
      duration: Date.now() - start,
    };
  }
}