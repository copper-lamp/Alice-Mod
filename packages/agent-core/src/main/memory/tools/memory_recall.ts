/**
 * memory_recall — 记忆检索工具
 *
 * 支持三种检索方式：
 * 1. 精确 ID 查询
 * 2. 条件检索（按类型/分支/标签/关键词/重要度）
 * 3. 语义检索（输入自然语言，返回最相似的记忆）
 */

import type { ToolSchema, ToolResult } from '@mcagent/shared';
import { ToolCategory } from '@mcagent/shared';
import type { MemoryManager } from '../memory-manager';

// ════════════════════════════════════════════════════════════════
// Schema
// ════════════════════════════════════════════════════════════════

export const MEMORY_RECALL_TOOL: ToolSchema = {
  name: 'memory_recall',
  description: '检索记忆。支持三种模式：(1) 按 ID 精确查询 (2) 按条件检索（类型/分支/标签/关键词/重要度） (3) 语义检索（输入自然语言，返回最相似的记忆）',
  category: ToolCategory.Memory,
  parameters: {
    id: {
      type: 'string',
      description: '记忆 ID（精确查询时使用，与其它条件互斥）',
      required: false,
    },
    type: {
      type: 'string',
      description: '按记忆类型筛选',
      required: false,
    },
    branch: {
      type: 'string',
      description: '按记忆分支筛选',
      required: false,
    },
    tags: {
      type: 'array',
      description: '按标签筛选（包含任意一个即匹配）',
      required: false,
    },
    keywords: {
      type: 'array',
      description: '关键词列表，在记忆内容中模糊搜索',
      required: false,
    },
    minImportance: {
      type: 'number',
      description: '最低重要度（>= 此值），范围 1-10',
      required: false,
    },
    similarTo: {
      type: 'string',
      description: '语义查询文本，输入自然语言描述，返回最相似的记忆',
      required: false,
    },
    limit: {
      type: 'number',
      description: '返回数量上限，默认 20',
      required: false,
    },
    offset: {
      type: 'number',
      description: '分页偏移量',
      required: false,
    },
    orderBy: {
      type: 'string',
      description: '排序字段：created_at/importance/access_count/updated_at',
      required: false,
    },
    orderDir: {
      type: 'string',
      description: '排序方向：asc/desc',
      required: false,
    },
  },
};

// ════════════════════════════════════════════════════════════════
// 执行函数
// ════════════════════════════════════════════════════════════════

interface RecallParams {
  id?: string;
  type?: string;
  branch?: string;
  tags?: string[];
  keywords?: string[];
  minImportance?: number;
  similarTo?: string;
  limit?: number;
  offset?: number;
  orderBy?: string;
  orderDir?: string;
}

export async function memoryRecall(
  manager: MemoryManager,
  params: RecallParams,
  workspaceId?: string,
): Promise<ToolResult<{ memories: unknown[]; total: number }>> {
  const start = Date.now();
  try {
    const result = await manager.recall({
      id: params.id,
      type: params.type as any,
      branch: params.branch as any,
      tags: params.tags,
      keywords: params.keywords,
      minImportance: params.minImportance,
      similarTo: params.similarTo,
      workspaceId,
      limit: params.limit ?? 20,
      offset: params.offset ?? 0,
      orderBy: params.orderBy as any,
      orderDir: params.orderDir as any,
    });

    return {
      success: true,
      data: {
        memories: result.memories,
        total: result.total,
      },
      duration: Date.now() - start,
    };
  } catch (err) {
    return {
      success: false,
      error: `记忆检索失败: ${(err as Error).message}`,
      duration: Date.now() - start,
    };
  }
}