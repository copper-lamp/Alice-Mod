/**
 * map_query_nearby — 地图邻近查询工具
 *
 * 以某坐标为中心，搜索半径范围内的地图特征。
 * 支持按类型筛选和数量限制。
 */

import type { ToolSchema, ToolResult } from '@mcagent/shared';
import { ToolCategory } from '@mcagent/shared';
import type { MapIndex } from '../map-index';
import type { NearbyQueryParams } from '../types';

// ════════════════════════════════════════════════════════════════
// Schema
// ════════════════════════════════════════════════════════════════

export const MAP_QUERY_NEARBY_TOOL: ToolSchema = {
  name: 'map_query_nearby',
  description: '以某坐标为中心，搜索半径范围内的地图特征（资源点、建筑、生物群系等）。返回结果按距离排序。',
  category: ToolCategory.Memory,
  parameters: {
    x: {
      type: 'number',
      description: '中心点 X 坐标',
      required: true,
    },
    z: {
      type: 'number',
      description: '中心点 Z 坐标',
      required: true,
    },
    radius: {
      type: 'number',
      description: '搜索半径（方块），默认 64',
      required: false,
    },
    dimension: {
      type: 'string',
      description: '维度：overworld（主世界）/ nether（下界）/ the_end（末地）',
      required: true,
    },
    type: {
      type: 'string',
      description: '特征类型筛选：point（标记点）/ resource（资源）/ structure（建筑）/ biome（生物群系）/ base（基地）/ waypoint（路径点）',
      required: false,
    },
    limit: {
      type: 'number',
      description: '返回数量上限，默认 50',
      required: false,
    },
  },
};

// ════════════════════════════════════════════════════════════════
// 执行函数
// ════════════════════════════════════════════════════════════════

export async function mapQueryNearby(
  mapIndex: MapIndex,
  params: Record<string, unknown>,
): Promise<ToolResult<Record<string, unknown>>> {
  const start = Date.now();
  try {
    const queryParams: NearbyQueryParams = {
      x: params.x as number,
      z: params.z as number,
      radius: (params.radius as number) ?? 64,
      dimension: params.dimension as NearbyQueryParams['dimension'],
      type: params.type as NearbyQueryParams['type'],
      limit: (params.limit as number) ?? 50,
    };

    const result = mapIndex.queryNearby(queryParams);

    return {
      success: true,
      data: {
        features: result.features,
        count: result.count,
        center: result.center,
        radius: result.radius,
      } as unknown as Record<string, unknown>,
      duration: Date.now() - start,
    };
  } catch (err) {
    return {
      success: false,
      error: `邻近查询失败: ${(err as Error).message}`,
      duration: Date.now() - start,
    };
  }
}