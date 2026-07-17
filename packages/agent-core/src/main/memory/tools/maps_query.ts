/**
 * maps_query — 地图路径点搜索工具
 *
 * 支持按关键词搜索和按半径搜索两种模式。
 * 关键词搜索匹配 name/description/tags，半径搜索使用 MapIndex 空间索引。
 * 两种模式可组合使用（取交集）。
 */

import type { ToolSchema, ToolResult } from '@mcagent/shared';
import { ToolCategory } from '@mcagent/shared';
import type { MemoryManager } from '../memory-manager';

// ════════════════════════════════════════════════════════════════
// Schema
// ════════════════════════════════════════════════════════════════

export const MAPS_QUERY_TOOL: ToolSchema = {
  name: 'maps_query',
  description: '搜索地图路径点。支持按关键词搜索（匹配 name/description/tags）和按半径搜索两种模式，可组合使用',
  category: ToolCategory.Maps,
  parameters: {
    keywords: {
      type: 'array',
      description: '关键词列表，匹配路径点名称、描述和标签（多个关键词取 AND 逻辑）',
      required: false,
      items: { type: 'string' },
    },
    x: {
      type: 'number',
      description: '半径搜索中心 X 坐标（与 radius 配合使用）',
      required: false,
    },
    z: {
      type: 'number',
      description: '半径搜索中心 Z 坐标',
      required: false,
    },
    radius: {
      type: 'number',
      description: '搜索半径（格）',
      required: false,
    },
    dimension: {
      type: 'string',
      description: '过滤维度：overworld（主世界）| nether（下界）| the_end（末地）',
      required: false,
    },
    limit: {
      type: 'number',
      description: '返回数量上限，默认 20',
      required: false,
      default: 20,
    },
  },
};

// ════════════════════════════════════════════════════════════════
// 执行函数
// ════════════════════════════════════════════════════════════════

export async function mapsQuery(
  manager: MemoryManager,
  params: {
    keywords?: string[];
    x?: number;
    z?: number;
    radius?: number;
    dimension?: string;
    limit?: number;
  },
): Promise<ToolResult<{ waypoints: Array<{
  id: string;
  dimension: string;
  x: number;
  y: number;
  z: number;
  name: string;
  description?: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}>; total: number }>> {
  const start = Date.now();
  try {
    const limit = params.limit ?? 20;
    let features: Array<Record<string, any>> = [];

    // 模式1：半径搜索（使用 MapIndex 空间索引）
    if (params.x !== undefined && params.z !== undefined && params.radius !== undefined) {
      const nearbyResult = await manager.mapIndex.queryNearby({
        x: params.x,
        z: params.z,
        radius: params.radius,
        dimension: (params.dimension as any) ?? 'overworld',
        limit,
      });
      features = nearbyResult.features.map(f => ({
        id: f.id,
        dimension: params.dimension ?? 'overworld',
        name: f.name ?? '',
        featureType: f.featureType,
        x: f.x,
        y: f.y,
        z: f.z,
        tags: f.tags,
        distance: f.distance,
      }));
    }

    // 模式2：关键词搜索（通过 SQLite 查询 memory 表）
    if (params.keywords && params.keywords.length > 0) {
      const result = await manager.list({
        type: 'map_point' as any,
        keywords: params.keywords,
        workspaceId: undefined,
        limit: 1000,
      });
      const keywordFeatures = result.memories.map(m => {
        const content = m.content as Record<string, any>;
        return {
          id: m.id,
          dimension: content.dimension ?? 'overworld',
          name: content.name ?? '',
          description: content.description ?? '',
          x: content.x ?? 0,
          y: content.y ?? 0,
          z: content.z ?? 0,
          tags: m.tags,
          createdAt: m.createdAt,
          updatedAt: m.updatedAt,
        };
      });

      // 如果已有半径搜索结果，取交集
      if (features.length > 0) {
        const featureIds = new Set(features.map(f => f.id));
        features = keywordFeatures.filter(f => featureIds.has(f.id));
      } else {
        features = keywordFeatures;
      }
    }

    // 按维度过滤
    if (params.dimension && features.length > 0 && !params.x) {
      features = features.filter((f: any) => f.dimension === params.dimension);
    }

    // 映射到统一格式
    const waypoints = features.slice(0, limit).map((f: any) => ({
      id: f.id,
      dimension: f.dimension,
      x: f.x,
      y: f.y ?? 64,
      z: f.z,
      name: f.name,
      description: f.description,
      tags: f.tags ?? [],
      createdAt: f.createdAt ?? Date.now(),
      updatedAt: f.updatedAt ?? Date.now(),
    }));

    return {
      success: true,
      data: { waypoints, total: waypoints.length },
      duration: Date.now() - start,
    };
  } catch (err) {
    return {
      success: false,
      error: `路径点搜索失败: ${(err as Error).message}`,
      duration: Date.now() - start,
    };
  }
}