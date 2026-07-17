/**
 * maps_edit — 地图路径点编辑工具（创建/修改/删除）
 *
 * 通过 action 参数区分操作模式：
 * - create：创建新路径点
 * - update：修改现有路径点
 * - delete：删除路径点
 *
 * 路径点存储为 map_point 类型的记忆，并在 MapIndex 中建立空间索引。
 */

import type { ToolSchema, ToolResult } from '@mcagent/shared';
import { ToolCategory } from '@mcagent/shared';
import type { MemoryManager } from '../memory-manager';

// ════════════════════════════════════════════════════════════════
// Schema
// ════════════════════════════════════════════════════════════════

export const MAPS_EDIT_TOOL: ToolSchema = {
  name: 'maps_edit',
  description: '创建、修改或删除地图路径点。通过 action 参数区分操作模式：create=创建, update=修改, delete=删除',
  category: ToolCategory.Maps,
  parameters: {
    action: {
      type: 'string',
      description: '操作类型：create（创建）| update（修改）| delete（删除）',
      required: true,
      enum: ['create', 'update', 'delete'],
    },
    id: {
      type: 'string',
      description: '路径点 ID（update/delete 时必填）',
      required: false,
    },
    dimension: {
      type: 'string',
      description: '维度：overworld（主世界）| nether（下界）| the_end（末地）（create 时必填）',
      required: false,
      enum: ['overworld', 'nether', 'the_end'],
    },
    x: {
      type: 'number',
      description: 'X 坐标（create 时必填）',
      required: false,
    },
    y: {
      type: 'number',
      description: 'Y 坐标（create 时必填）',
      required: false,
    },
    z: {
      type: 'number',
      description: 'Z 坐标（create 时必填）',
      required: false,
    },
    name: {
      type: 'string',
      description: '路径点名称（create 时必填，update 时可选）',
      required: false,
    },
    description: {
      type: 'string',
      description: '路径点描述（可选）',
      required: false,
    },
    tags: {
      type: 'array',
      description: '标签列表',
      required: false,
      items: { type: 'string' },
    },
  },
};

// ════════════════════════════════════════════════════════════════
// 执行函数
// ════════════════════════════════════════════════════════════════

export async function mapsEdit(
  manager: MemoryManager,
  params: {
    action: 'create' | 'update' | 'delete';
    id?: string;
    dimension?: string;
    x?: number;
    y?: number;
    z?: number;
    name?: string;
    description?: string;
    tags?: string[];
  },
  workspaceId?: string,
): Promise<ToolResult<{ id?: string; success?: boolean }>> {
  const start = Date.now();
  try {
    switch (params.action) {
      case 'create': {
        if (!params.dimension || params.x === undefined || params.y === undefined || params.z === undefined || !params.name) {
          return {
            success: false,
            error: '创建路径点时缺少必填参数：dimension, x, y, z, name',
            duration: Date.now() - start,
          };
        }
        const result = await manager.store({
          type: 'map_point' as any,
          content: {
            name: params.name,
            dimension: params.dimension,
            x: params.x,
            y: params.y,
            z: params.z,
            description: params.description ?? '',
            type: 'waypoint',
          },
          tags: params.tags ?? [],
          importance: 5,
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
            error: '更新路径点时缺少必填参数：id',
            duration: Date.now() - start,
          };
        }
        const existing = await manager.getById(params.id);
        if (!existing) {
          return {
            success: false,
            error: `路径点 ${params.id} 不存在`,
            duration: Date.now() - start,
          };
        }
        const currentContent = existing.content as Record<string, any>;
        const updates: Record<string, unknown> = {
          content: {
            name: params.name ?? currentContent.name ?? '',
            dimension: params.dimension ?? currentContent.dimension ?? 'overworld',
            x: params.x ?? currentContent.x ?? 0,
            y: params.y ?? currentContent.y ?? 64,
            z: params.z ?? currentContent.z ?? 0,
            description: params.description ?? currentContent.description ?? '',
            type: 'waypoint',
          },
        };
        if (params.tags !== undefined) updates.tags = params.tags;
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
            error: '删除路径点时缺少必填参数：id',
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
      error: `路径点操作失败: ${(err as Error).message}`,
      duration: Date.now() - start,
    };
  }
}