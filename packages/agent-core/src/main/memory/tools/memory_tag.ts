/**
 * memory_tag — 记忆标签管理工具
 *
 * 为指定记忆添加或移除标签。标签变更不影响向量嵌入。
 */

import type { ToolSchema, ToolResult } from '@mcagent/shared';
import { ToolCategory } from '@mcagent/shared';
import type { MemoryManager } from '../memory-manager';

// ════════════════════════════════════════════════════════════════
// Schema
// ════════════════════════════════════════════════════════════════

export const MEMORY_TAG_TOOL: ToolSchema = {
  name: 'memory_tag',
  description: '为指定记忆添加一个标签。标签用于分类检索，不影响向量嵌入',
  category: ToolCategory.Memory,
  parameters: {
    id: {
      type: 'string',
      description: '记忆 ID',
      required: true,
    },
    tag: {
      type: 'string',
      description: '要添加的标签名称',
      required: true,
    },
  },
};

export const MEMORY_UNTAG_TOOL: ToolSchema = {
  name: 'memory_untag',
  description: '为指定记忆移除一个标签',
  category: ToolCategory.Memory,
  parameters: {
    id: {
      type: 'string',
      description: '记忆 ID',
      required: true,
    },
    tag: {
      type: 'string',
      description: '要移除的标签名称',
      required: true,
    },
  },
};

// ════════════════════════════════════════════════════════════════
// 执行函数
// ════════════════════════════════════════════════════════════════

export async function memoryTag(
  manager: MemoryManager,
  params: { id: string; tag: string },
): Promise<ToolResult<null>> {
  const start = Date.now();
  try {
    await manager.addTag(params.id, params.tag);
    return {
      success: true,
      data: null,
      duration: Date.now() - start,
    };
  } catch (err) {
    return {
      success: false,
      error: `标签添加失败: ${(err as Error).message}`,
      duration: Date.now() - start,
    };
  }
}

export async function memoryUntag(
  manager: MemoryManager,
  params: { id: string; tag: string },
): Promise<ToolResult<null>> {
  const start = Date.now();
  try {
    await manager.removeTag(params.id, params.tag);
    return {
      success: true,
      data: null,
      duration: Date.now() - start,
    };
  } catch (err) {
    return {
      success: false,
      error: `标签移除失败: ${(err as Error).message}`,
      duration: Date.now() - start,
    };
  }
}