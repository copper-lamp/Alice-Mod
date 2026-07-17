/**
 * memory_edit — 记忆编辑工具（创建/修改/删除）
 *
 * 通过 action 参数区分操作模式：
 * - create：创建新记忆
 * - update：修改现有记忆
 * - delete：删除记忆
 *
 * 记忆类型简化为 3 种：event（事件）/character（人物）/experience（经验）
 * content 为纯文本字符串，内部存储为 { name, text } 结构
 */

import type { ToolSchema, ToolResult } from '@mcagent/shared';
import { ToolCategory } from '@mcagent/shared';
import type { MemoryManager } from '../memory-manager';

// ════════════════════════════════════════════════════════════════
// Schema
// ════════════════════════════════════════════════════════════════

export const MEMORY_EDIT_TOOL: ToolSchema = {
  name: 'memory_edit',
  description: '创建、修改或删除记忆。通过 action 参数区分操作模式：create=创建, update=修改, delete=删除',
  category: ToolCategory.Memory,
  parameters: {
    action: {
      type: 'string',
      description: '操作类型：create（创建）| update（修改）| delete（删除）',
      required: true,
      enum: ['create', 'update', 'delete'],
    },
    id: {
      type: 'string',
      description: '记忆 ID（update/delete 时必填）',
      required: false,
    },
    type: {
      type: 'string',
      description: '记忆类型：event（事件）| character（人物）| experience（经验）（create 时必填）',
      required: false,
      enum: ['event', 'character', 'experience'],
    },
    name: {
      type: 'string',
      description: '记忆名称（create 时必填，update 时可选）',
      required: false,
    },
    content: {
      type: 'string',
      description: '记忆内容，一段纯文本描述（create 时必填，update 时可选）',
      required: false,
    },
    tags: {
      type: 'array',
      description: '标签列表，用于分类检索',
      required: false,
      items: { type: 'string' },
    },
    importance: {
      type: 'number',
      description: '重要度 1-10（10=最重要，永不过期），默认 5',
      required: false,
      default: 5,
    },
  },
};

// ════════════════════════════════════════════════════════════════
// 执行函数
// ════════════════════════════════════════════════════════════════

export async function memoryEdit(
  manager: MemoryManager,
  params: {
    action: 'create' | 'update' | 'delete';
    id?: string;
    type?: string;
    name?: string;
    content?: string;
    tags?: string[];
    importance?: number;
  },
  workspaceId?: string,
): Promise<ToolResult<{ id?: string; success?: boolean }>> {
  const start = Date.now();
  try {
    switch (params.action) {
      case 'create': {
        if (!params.type || !params.name || !params.content) {
          return {
            success: false,
            error: '创建记忆时缺少必填参数：type, name, content',
            duration: Date.now() - start,
          };
        }
        const result = await manager.store({
          type: params.type as any,
          content: { name: params.name, text: params.content },
          tags: params.tags ?? [],
          importance: params.importance ?? 5,
        }, workspaceId);
        return {
          success: true,
          data: { id: result.id },
          duration: Date.now() - start,
        };
      }

      case 'update': {
        if (!params.id) {
          return {
            success: false,
            error: '更新记忆时缺少必填参数：id',
            duration: Date.now() - start,
          };
        }
        const updates: Record<string, unknown> = {};
        if (params.name !== undefined || params.content !== undefined) {
          const existing = await manager.getById(params.id);
          const currentContent = existing?.content as Record<string, unknown> ?? {};
          updates.content = {
            name: params.name ?? currentContent.name ?? '',
            text: params.content ?? currentContent.text ?? '',
          };
        }
        if (params.tags !== undefined) updates.tags = params.tags;
        if (params.importance !== undefined) updates.importance = params.importance;
        await manager.update(params.id, updates as any);
        return {
          success: true,
          data: { id: params.id, success: true },
          duration: Date.now() - start,
        };
      }

      case 'delete': {
        if (!params.id) {
          return {
            success: false,
            error: '删除记忆时缺少必填参数：id',
            duration: Date.now() - start,
          };
        }
        await manager.forget(params.id);
        return {
          success: true,
          data: { id: params.id, success: true },
          duration: Date.now() - start,
        };
      }

      default:
        return {
          success: false,
          error: `未知操作类型: ${params.action}`,
          duration: Date.now() - start,
        };
    }
  } catch (err) {
    return {
      success: false,
      error: `记忆操作失败: ${(err as Error).message}`,
      duration: Date.now() - start,
    };
  }
}