/**
 * map_get_overview — 地图区域概览工具
 *
 * 获取指定坐标区域的综合地图摘要，包含特征统计、命名区域、关键点等信息。
 * 概览摘要基于规则模板生成，不需要 LLM 参与。
 */

import type { ToolSchema, ToolResult } from '@mcagent/shared';
import { ToolCategory } from '@mcagent/shared';
import type { MapIndex } from '../map-index';
import type { OverviewParams } from '../types';

// ════════════════════════════════════════════════════════════════
// Schema
// ════════════════════════════════════════════════════════════════

export const MAP_GET_OVERVIEW_TOOL: ToolSchema = {
  name: 'map_get_overview',
  description: '获取指定坐标区域的综合地图摘要，包含特征统计、命名区域、关键点等信息。概览摘要由系统自动生成。',
  category: ToolCategory.Memory,
  parameters: {
    x: {
      type: 'number',
      description: '区域中心 X 坐标',
      required: true,
    },
    z: {
      type: 'number',
      description: '区域中心 Z 坐标',
      required: true,
    },
    radius: {
      type: 'number',
      description: '概览范围半径（方块），默认 128',
      required: false,
    },
    dimension: {
      type: 'string',
      description: '维度：overworld（主世界）/ nether（下界）/ the_end（末地）',
      required: true,
    },
  },
};

// ════════════════════════════════════════════════════════════════
// 执行函数
// ════════════════════════════════════════════════════════════════

export async function mapGetOverview(
  mapIndex: MapIndex,
  params: Record<string, unknown>,
): Promise<ToolResult<Record<string, unknown>>> {
  const start = Date.now();
  try {
    const queryParams: OverviewParams = {
      x: params.x as number,
      z: params.z as number,
      radius: (params.radius as number) ?? 128,
      dimension: params.dimension as OverviewParams['dimension'],
    };

    const result = mapIndex.getOverview(queryParams);

    return {
      success: true,
      data: {
        summary: result.summary,
        featureStats: result.featureStats,
        regions: result.regions,
        highlights: result.highlights,
        bounds: result.bounds,
      } as unknown as Record<string, unknown>,
      duration: Date.now() - start,
    };
  } catch (err) {
    return {
      success: false,
      error: `区域概览失败: ${(err as Error).message}`,
      duration: Date.now() - start,
    };
  }
}