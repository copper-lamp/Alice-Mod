/**
 * memory_store — 记忆存储工具
 *
 * 将新记忆存储到记忆系统，支持单条和批量存储。
 * 自动生成向量嵌入，存入 Chroma 向量数据库。
 */

import type { ToolSchema, ToolResult } from '@mcagent/shared';
import { ToolCategory } from '@mcagent/shared';
import type { MemoryManager } from '../memory-manager';
import type { StoreParams, BatchStoreParams } from '../types';

// ════════════════════════════════════════════════════════════════
// Schema
// ════════════════════════════════════════════════════════════════

export const MEMORY_STORE_TOOL: ToolSchema = {
  name: 'memory_store',
  description: '存储一条新记忆，自动生成向量嵌入。支持所有记忆类型（player_habit/map_point/task_experience/social/skill）',
  category: ToolCategory.Memory,
  parameters: {
    type: {
      type: 'string',
      description: '记忆类型：player_habit=玩家习惯, map_point=地图坐标, task_experience=任务经验, social=社交关系, skill=技能',
      required: true,
    },
    branch: {
      type: 'string',
      description: '记忆分支：character/emotion/environment/experience/knowledge/user_preference/emotion_log/task_archive',
      required: false,
    },
    content: {
      type: 'object',
      description: '记忆内容，结构化 JSON 对象',
      required: true,
    },
    tags: {
      type: 'array',
      description: '标签列表，用于分类检索',
      required: false,
    },
    importance: {
      type: 'number',
      description: '重要度 1-10（10 为最重要，永不过期），默认 5',
      required: false,
    },
    expiresAt: {
      type: 'number',
      description: '过期时间戳（ms），null 表示永不过期',
      required: false,
    },
  },
};

export const MEMORY_BATCH_STORE_TOOL: ToolSchema = {
  name: 'memory_batch_store',
  description: '批量存储多条记忆，比逐条存储更高效',
  category: ToolCategory.Memory,
  parameters: {
    items: {
      type: 'array',
      description: '记忆列表，每条包含 type/content/tags/importance 等字段',
      required: true,
    },
  },
};

// ════════════════════════════════════════════════════════════════
// 执行函数
// ════════════════════════════════════════════════════════════════

export async function memoryStore(
  manager: MemoryManager,
  params: StoreParams,
  workspaceId?: string,
): Promise<ToolResult<{ id: string; createdAt: number }>> {
  const start = Date.now();
  try {
    const result = await manager.store(params, workspaceId);
    return {
      success: true,
      data: result,
      duration: Date.now() - start,
    };
  } catch (err) {
    return {
      success: false,
      error: `记忆存储失败: ${(err as Error).message}`,
      duration: Date.now() - start,
    };
  }
}

export async function memoryBatchStore(
  manager: MemoryManager,
  params: BatchStoreParams,
  workspaceId?: string,
): Promise<ToolResult<{ ids: string[]; count: number }>> {
  const start = Date.now();
  try {
    const result = await manager.batchStore(params, workspaceId);
    return {
      success: true,
      data: result,
      duration: Date.now() - start,
    };
  } catch (err) {
    return {
      success: false,
      error: `批量记忆存储失败: ${(err as Error).message}`,
      duration: Date.now() - start,
    };
  }
}