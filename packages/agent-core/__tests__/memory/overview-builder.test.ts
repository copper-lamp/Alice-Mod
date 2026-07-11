/**
 * OverviewBuilder 单元测试
 *
 * 测试概览摘要生成器：
 * - 空区域概览
 * - 多特征统计
 * - 命名区域描述
 * - 关键点提取
 */

import { describe, it, expect } from 'vitest';
import { OverviewBuilder } from '../../src/main/memory/overview-builder';
import type { MapFeature, MapRegion, OverviewRegion } from '../../src/main/memory/types';

function makeFeature(overrides: Partial<MapFeature>): MapFeature {
  return {
    id: overrides.id ?? 'f1',
    featureType: overrides.featureType ?? 'point',
    name: overrides.name,
    x: overrides.x ?? 0,
    y: overrides.y ?? 0,
    z: overrides.z ?? 0,
    dimension: overrides.dimension ?? 'overworld',
    tags: overrides.tags ?? [],
    updatedAt: Date.now(),
  };
}

function makeRegion(overrides: Partial<MapRegion>): MapRegion {
  return {
    id: overrides.id ?? 'r1',
    name: overrides.name ?? 'test',
    regionType: overrides.regionType ?? 'base',
    x1: overrides.x1 ?? 0,
    z1: overrides.z1 ?? 0,
    x2: overrides.x2 ?? 100,
    z2: overrides.z2 ?? 100,
    dimension: overrides.dimension ?? 'overworld',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

describe('OverviewBuilder', () => {
  describe('buildSummary', () => {
    it('should include location info', () => {
      const summary = OverviewBuilder.buildSummary([], [], { x1: -100, z1: -100, x2: 100, z2: 100 }, 'overworld');
      expect(summary).toContain('位置: overworld');
      expect(summary).toContain('(-100,-100)');
      expect(summary).toContain('(100,100)');
    });

    it('should include region descriptions', () => {
      const regions: OverviewRegion[] = [
        { id: 'r1', name: '主基地', regionType: 'base', x1: 0, z1: 0, x2: 50, z2: 50 },
      ];
      const summary = OverviewBuilder.buildSummary([], regions, { x1: -100, z1: -100, x2: 100, z2: 100 }, 'overworld');
      expect(summary).toContain('命名区域: 主基地[base]');
    });

    it('should include feature stats', () => {
      const features = [
        makeFeature({ featureType: 'resource' }),
        makeFeature({ featureType: 'resource' }),
        makeFeature({ featureType: 'structure' }),
      ];
      const summary = OverviewBuilder.buildSummary(features, [], { x1: 0, z1: 0, x2: 100, z2: 100 }, 'overworld');
      expect(summary).toContain('resource×2');
      expect(summary).toContain('structure×1');
    });

    it('should show "特征: 无" when no features', () => {
      const summary = OverviewBuilder.buildSummary([], [], { x1: 0, z1: 0, x2: 100, z2: 100 }, 'overworld');
      expect(summary).toContain('特征: 无');
    });

    it('should include important/hot tagged features as highlights', () => {
      const features = [
        makeFeature({ id: 'hot', tags: ['hot'], name: '热点' }),
        makeFeature({ id: 'imp', tags: ['important'], name: '重要点' }),
        makeFeature({ id: 'normal', tags: [], name: '普通点' }),
      ];
      const summary = OverviewBuilder.buildSummary(features, [], { x1: 0, z1: 0, x2: 100, z2: 100 }, 'overworld');
      expect(summary).toContain('关键点: 热点');
      expect(summary).toContain('重要点');
    });
  });

  describe('countByType', () => {
    it('should count features by type', () => {
      const features = [
        makeFeature({ featureType: 'resource' }),
        makeFeature({ featureType: 'resource' }),
        makeFeature({ featureType: 'structure' }),
        makeFeature({ featureType: 'point' }),
      ];
      const stats = OverviewBuilder.countByType(features);
      expect(stats.resource).toBe(2);
      expect(stats.structure).toBe(1);
      expect(stats.point).toBe(1);
    });

    it('should return empty object for empty array', () => {
      const stats = OverviewBuilder.countByType([]);
      expect(stats).toEqual({});
    });
  });

  describe('findOverlappingRegions', () => {
    it('should find overlapping regions', () => {
      const regions = new Map<string, MapRegion>();
      regions.set('r1', makeRegion({ id: 'r1', name: '重叠区', x1: 0, z1: 0, x2: 100, z2: 100 }));
      regions.set('r2', makeRegion({ id: 'r2', name: '不重叠区', x1: 500, z1: 500, x2: 600, z2: 600 }));

      const result = OverviewBuilder.findOverlappingRegions(
        regions,
        { x1: 50, z1: 50, x2: 150, z2: 150 },
        'overworld',
      );
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('重叠区');
    });

    it('should filter by dimension', () => {
      const regions = new Map<string, MapRegion>();
      regions.set('r1', makeRegion({ id: 'r1', name: '主世界', dimension: 'overworld' }));
      regions.set('r2', makeRegion({ id: 'r2', name: '下界', dimension: 'nether' }));

      const result = OverviewBuilder.findOverlappingRegions(
        regions,
        { x1: 0, z1: 0, x2: 100, z2: 100 },
        'nether',
      );
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('下界');
    });
  });

  describe('extractHighlights', () => {
    it('should prefer tagged features', () => {
      const features = [
        makeFeature({ id: 'f1', tags: ['important'], name: '重要' }),
        makeFeature({ id: 'f2', tags: ['hot'], name: '热点' }),
        makeFeature({ id: 'f3', tags: [], name: '普通' }),
      ];
      const highlights = OverviewBuilder.extractHighlights(features, 5);
      expect(highlights).toHaveLength(2);
      expect(highlights.map(h => h.name)).toEqual(['重要', '热点']);
    });

    it('should return first features when no tagged', () => {
      const features = [
        makeFeature({ id: 'f1', name: 'A' }),
        makeFeature({ id: 'f2', name: 'B' }),
      ];
      const highlights = OverviewBuilder.extractHighlights(features, 5);
      expect(highlights).toHaveLength(2);
    });

    it('should respect maxCount', () => {
      const features = Array.from({ length: 10 }, (_, i) =>
        makeFeature({ id: `f${i}`, tags: ['important'], name: `F${i}` }),
      );
      const highlights = OverviewBuilder.extractHighlights(features, 3);
      expect(highlights).toHaveLength(3);
    });
  });
});