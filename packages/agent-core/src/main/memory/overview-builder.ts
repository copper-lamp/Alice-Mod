/**
 * OverviewBuilder — 概览摘要生成器
 *
 * 为 map_get_overview 工具提供结构化摘要生成。
 * 基于规则模板，不需要 LLM 参与。
 */

import type { MapFeature, MapRegion, OverviewRegion, OverviewHighlight } from './types';

export class OverviewBuilder {
  /**
   * 构建区域概览摘要文本
   */
  static buildSummary(
    features: MapFeature[],
    regions: OverviewRegion[],
    bounds: { x1: number; z1: number; x2: number; z2: number },
    dimension: string,
  ): string {
    const parts: string[] = [];

    // 1. 区域范围
    parts.push(`位置: ${dimension} (${bounds.x1},${bounds.z1}) ~ (${bounds.x2},${bounds.z2})`);

    // 2. 命名区域
    if (regions.length > 0) {
      const regionDesc = regions.map(r => `${r.name}[${r.regionType}]`).join(', ');
      parts.push(`命名区域: ${regionDesc}`);
    }

    // 3. 特征统计
    const stats = this.countByType(features);
    if (Object.keys(stats).length > 0) {
      const statDesc = Object.entries(stats)
        .map(([k, v]) => `${k}×${v}`)
        .join(', ');
      parts.push(`特征: ${statDesc}`);
    } else {
      parts.push('特征: 无');
    }

    // 4. 关键点
    const hotspots = features
      .filter(f => f.tags.includes('important') || f.tags.includes('hot'))
      .slice(0, 3);
    if (hotspots.length > 0) {
      parts.push(`关键点: ${hotspots.map(h => h.name || '未命名').join(', ')}`);
    }

    return parts.join('。');
  }

  /**
   * 按特征类型统计数量
   */
  static countByType(features: MapFeature[]): Record<string, number> {
    const stats: Record<string, number> = {};
    for (const f of features) {
      stats[f.featureType] = (stats[f.featureType] || 0) + 1;
    }
    return stats;
  }

  /**
   * 查找重叠的命名区域
   */
  static findOverlappingRegions(
    regions: Map<string, MapRegion>,
    bounds: { x1: number; z1: number; x2: number; z2: number },
    dimension: string,
  ): OverviewRegion[] {
    const { x1, z1, x2, z2 } = bounds;
    const result: OverviewRegion[] = [];

    for (const region of regions.values()) {
      if (region.dimension !== dimension) continue;
      // 矩形重叠检测
      if (region.x1 <= x2 && region.x2 >= x1 && region.z1 <= z2 && region.z2 >= z1) {
        result.push({
          id: region.id,
          name: region.name,
          regionType: region.regionType,
          x1: region.x1,
          z1: region.z1,
          x2: region.x2,
          z2: region.z2,
        });
      }
    }

    return result;
  }

  /**
   * 提取关键点
   */
  static extractHighlights(features: MapFeature[], maxCount = 5): OverviewHighlight[] {
    // 优先取 tagged 特征
    const tagged = features
      .filter(f => f.tags.includes('important') || f.tags.includes('hot'))
      .slice(0, maxCount)
      .map(f => ({
        name: f.name,
        featureType: f.featureType,
        x: f.x,
        z: f.z,
      }));

    if (tagged.length > 0) return tagged;

    // 取前几个最近的
    return features.slice(0, 3).map(f => ({
      name: f.name,
      featureType: f.featureType,
      x: f.x,
      z: f.z,
    }));
  }
}