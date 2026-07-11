/**
 * MapIndex 单元测试
 *
 * 测试地图索引引擎的核心功能：
 * - 邻近查询（空索引/单特征/多特征排序/跨维度隔离/类型筛选/数量限制）
 * - 矩形区域查询
 * - 区域重叠检测
 * - 全量内存加载
 * - CRUD 操作
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MapIndex } from '../../src/main/memory/map-index';
import type { MapFeature, MapRegion } from '../../src/main/memory/types';

// ════════════════════════════════════════════════════════════════
// Mock SQLiteExecutor
// ════════════════════════════════════════════════════════════════

class MockSQLiteExecutor {
  private features: MapFeature[] = [];
  private regions: MapRegion[] = [];

  setFeatures(features: MapFeature[]) { this.features = features; }
  setRegions(regions: MapRegion[]) { this.regions = regions; }

  queryAll<T>(sql: string, _params?: Record<string, unknown>): T[] {
    if (sql.includes('map_features')) {
      return this.features.map(f => ({
        id: f.id,
        memory_id: f.memoryId ?? null,
        feature_type: f.featureType,
        name: f.name ?? null,
        x: f.x,
        y: f.y,
        z: f.z,
        dimension: f.dimension,
        tags: JSON.stringify(f.tags),
        metadata: f.metadata ? JSON.stringify(f.metadata) : null,
        updated_at: f.updatedAt,
      })) as unknown as T[];
    }
    if (sql.includes('map_regions')) {
      return this.regions.map(r => ({
        id: r.id,
        name: r.name,
        region_type: r.regionType,
        x1: r.x1,
        z1: r.z1,
        x2: r.x2,
        z2: r.z2,
        dimension: r.dimension,
        description: r.description ?? null,
        memory_id: r.memoryId ?? null,
        created_at: r.createdAt,
        updated_at: r.updatedAt,
      })) as unknown as T[];
    }
    return [] as unknown as T[];
  }

  run(sql: string, _params?: Record<string, unknown>): void {
    // noop
  }
}

// ════════════════════════════════════════════════════════════════
// 辅助函数
// ════════════════════════════════════════════════════════════════

function makeFeature(overrides: Partial<MapFeature>): MapFeature {
  return {
    id: overrides.id ?? 'f1',
    memoryId: overrides.memoryId,
    featureType: overrides.featureType ?? 'point',
    name: overrides.name,
    x: overrides.x ?? 0,
    y: overrides.y ?? 0,
    z: overrides.z ?? 0,
    dimension: overrides.dimension ?? 'overworld',
    tags: overrides.tags ?? [],
    updatedAt: overrides.updatedAt ?? Date.now(),
  };
}

function makeRegion(overrides: Partial<MapRegion>): MapRegion {
  return {
    id: overrides.id ?? 'r1',
    name: overrides.name ?? 'test-region',
    regionType: overrides.regionType ?? 'base',
    x1: overrides.x1 ?? 0,
    z1: overrides.z1 ?? 0,
    x2: overrides.x2 ?? 100,
    z2: overrides.z2 ?? 100,
    dimension: overrides.dimension ?? 'overworld',
    description: overrides.description,
    memoryId: overrides.memoryId,
    createdAt: overrides.createdAt ?? Date.now(),
    updatedAt: overrides.updatedAt ?? Date.now(),
  };
}

// ════════════════════════════════════════════════════════════════
// 测试
// ════════════════════════════════════════════════════════════════

describe('MapIndex', () => {
  let mockSqlite: MockSQLiteExecutor;
  let mapIndex: MapIndex;

  beforeEach(async () => {
    mockSqlite = new MockSQLiteExecutor();
    mapIndex = new MapIndex(mockSqlite, {
      info: () => {},
      warn: () => {},
      error: () => {},
    });
  });

  describe('全量内存加载', () => {
    it('should load features and regions from SQLite', async () => {
      mockSqlite.setFeatures([
        makeFeature({ id: 'f1', x: 100, z: 200, dimension: 'overworld' }),
        makeFeature({ id: 'f2', x: -50, z: -80, dimension: 'nether' }),
      ]);
      mockSqlite.setRegions([
        makeRegion({ id: 'r1', name: 'base1' }),
      ]);

      await mapIndex.load();

      const stats = mapIndex.stats();
      expect(stats.totalFeatures).toBe(2);
      expect(stats.totalRegions).toBe(1);
      expect(stats.byDimension.overworld).toBe(1);
      expect(stats.byDimension.nether).toBe(1);
    });
  });

  describe('queryNearby 邻近查询', () => {
    it('should return empty for empty index', () => {
      const result = mapIndex.queryNearby({
        x: 0, z: 0, radius: 64, dimension: 'overworld',
      });
      expect(result.features).toHaveLength(0);
      expect(result.count).toBe(0);
    });

    it('should find single feature within range', async () => {
      mockSqlite.setFeatures([
        makeFeature({ id: 'f1', x: 100, z: 200, dimension: 'overworld' }),
      ]);
      await mapIndex.load();

      const result = mapIndex.queryNearby({
        x: 100, z: 200, radius: 64, dimension: 'overworld',
      });
      expect(result.features).toHaveLength(1);
      expect(result.features[0].id).toBe('f1');
      expect(result.features[0].distance).toBe(0);
    });

    it('should sort results by distance ascending', async () => {
      mockSqlite.setFeatures([
        makeFeature({ id: 'far', x: 0, z: 100, dimension: 'overworld' }),
        makeFeature({ id: 'near', x: 0, z: 10, dimension: 'overworld' }),
        makeFeature({ id: 'mid', x: 0, z: 50, dimension: 'overworld' }),
      ]);
      await mapIndex.load();

      const result = mapIndex.queryNearby({
        x: 0, z: 0, radius: 200, dimension: 'overworld',
      });
      expect(result.features).toHaveLength(3);
      expect(result.features[0].id).toBe('near');
      expect(result.features[1].id).toBe('mid');
      expect(result.features[2].id).toBe('far');
    });

    it('should not return features from other dimensions', async () => {
      mockSqlite.setFeatures([
        makeFeature({ id: 'ow', x: 0, z: 0, dimension: 'overworld' }),
        makeFeature({ id: 'nether', x: 0, z: 0, dimension: 'nether' }),
      ]);
      await mapIndex.load();

      const result = mapIndex.queryNearby({
        x: 0, z: 0, radius: 64, dimension: 'overworld',
      });
      expect(result.features).toHaveLength(1);
      expect(result.features[0].id).toBe('ow');
    });

    it('should filter by type', async () => {
      mockSqlite.setFeatures([
        makeFeature({ id: 'p1', x: 0, z: 0, featureType: 'point', dimension: 'overworld' }),
        makeFeature({ id: 'r1', x: 10, z: 10, featureType: 'resource', dimension: 'overworld' }),
      ]);
      await mapIndex.load();

      const result = mapIndex.queryNearby({
        x: 0, z: 0, radius: 64, dimension: 'overworld', type: 'resource',
      });
      expect(result.features).toHaveLength(1);
      expect(result.features[0].id).toBe('r1');
    });

    it('should respect limit parameter', async () => {
      const features = Array.from({ length: 10 }, (_, i) =>
        makeFeature({ id: `f${i}`, x: i * 5, z: 0, dimension: 'overworld' }),
      );
      mockSqlite.setFeatures(features);
      await mapIndex.load();

      const result = mapIndex.queryNearby({
        x: 0, z: 0, radius: 200, dimension: 'overworld', limit: 3,
      });
      expect(result.features).toHaveLength(3);
    });

    it('should not return features outside radius', async () => {
      mockSqlite.setFeatures([
        makeFeature({ id: 'inside', x: 30, z: 0, dimension: 'overworld' }),
        makeFeature({ id: 'outside', x: 100, z: 0, dimension: 'overworld' }),
      ]);
      await mapIndex.load();

      const result = mapIndex.queryNearby({
        x: 0, z: 0, radius: 64, dimension: 'overworld',
      });
      expect(result.features).toHaveLength(1);
      expect(result.features[0].id).toBe('inside');
    });
  });

  describe('queryArea 矩形区域查询', () => {
    it('should return features within rectangle', async () => {
      mockSqlite.setFeatures([
        makeFeature({ id: 'inside', x: 50, z: 50, dimension: 'overworld' }),
        makeFeature({ id: 'outside', x: 200, z: 200, dimension: 'overworld' }),
      ]);
      await mapIndex.load();

      const result = mapIndex.queryArea({
        x1: 0, z1: 0, x2: 100, z2: 100, dimension: 'overworld',
      });
      expect(result.features).toHaveLength(1);
      expect(result.features[0].id).toBe('inside');
    });

    it('should support pagination', async () => {
      const features = Array.from({ length: 5 }, (_, i) =>
        makeFeature({ id: `f${i}`, x: i * 10, z: 0, dimension: 'overworld' }),
      );
      mockSqlite.setFeatures(features);
      await mapIndex.load();

      const result = mapIndex.queryArea({
        x1: 0, z1: 0, x2: 100, z2: 100, dimension: 'overworld',
        limit: 2, offset: 2,
      });
      expect(result.features).toHaveLength(2);
      expect(result.features[0].id).toBe('f2');
    });
  });

  describe('getOverview 区域概览', () => {
    it('should return summary with region info', async () => {
      mockSqlite.setFeatures([
        makeFeature({ id: 'f1', x: 0, z: 0, featureType: 'resource', dimension: 'overworld' }),
        makeFeature({ id: 'f2', x: 20, z: 20, featureType: 'structure', dimension: 'overworld' }),
      ]);
      mockSqlite.setRegions([
        makeRegion({ id: 'r1', name: '基地', regionType: 'base', x1: -50, z1: -50, x2: 50, z2: 50, dimension: 'overworld' }),
      ]);
      await mapIndex.load();

      const result = mapIndex.getOverview({
        x: 0, z: 0, radius: 128, dimension: 'overworld',
      });

      expect(result.summary).toContain('位置: overworld');
      expect(result.summary).toContain('命名区域: 基地');
      expect(result.featureStats.resource).toBe(1);
      expect(result.featureStats.structure).toBe(1);
      expect(result.regions).toHaveLength(1);
      expect(result.regions[0].name).toBe('基地');
    });

    it('should return empty stats for empty area', async () => {
      await mapIndex.load();

      const result = mapIndex.getOverview({
        x: 0, z: 0, radius: 128, dimension: 'overworld',
      });
      expect(result.featureStats).toEqual({});
      expect(result.regions).toHaveLength(0);
      expect(result.highlights).toHaveLength(0);
    });
  });

  describe('addFeature / removeFeature CRUD', () => {
    it('should add and query a feature', async () => {
      const feature = makeFeature({ id: 'new', x: 42, z: 100, dimension: 'overworld' });
      await mapIndex.addFeature(feature);

      const result = mapIndex.queryNearby({
        x: 42, z: 100, radius: 16, dimension: 'overworld',
      });
      expect(result.features).toHaveLength(1);
      expect(result.features[0].id).toBe('new');
    });

    it('should remove a feature', async () => {
      const feature = makeFeature({ id: 'to_remove', x: 0, z: 0, dimension: 'overworld' });
      await mapIndex.addFeature(feature);
      await mapIndex.removeFeature('to_remove');

      const result = mapIndex.queryNearby({
        x: 0, z: 0, radius: 64, dimension: 'overworld',
      });
      expect(result.features).toHaveLength(0);
    });

    it('should update a feature coordinates', async () => {
      const feature = makeFeature({ id: 'moving', x: 0, z: 0, dimension: 'overworld' });
      await mapIndex.addFeature(feature);
      await mapIndex.updateFeature('moving', { x: 100, z: 100 });

      const nearOld = mapIndex.queryNearby({ x: 0, z: 0, radius: 16, dimension: 'overworld' });
      expect(nearOld.features).toHaveLength(0);

      const nearNew = mapIndex.queryNearby({ x: 100, z: 100, radius: 16, dimension: 'overworld' });
      expect(nearNew.features).toHaveLength(1);
    });
  });

  describe('addRegion / removeRegion CRUD', () => {
    it('should add and find overlapping region', async () => {
      const region = makeRegion({ id: 'new_r', name: '新区', x1: -50, z1: -50, x2: 50, z2: 50 });
      await mapIndex.addRegion(region);

      const result = mapIndex.getOverview({ x: 0, z: 0, radius: 128, dimension: 'overworld' });
      expect(result.regions).toHaveLength(1);
      expect(result.regions[0].name).toBe('新区');
    });

    it('should remove a region', async () => {
      const region = makeRegion({ id: 'del_r', name: '待删除', x1: -10, z1: -10, x2: 10, z2: 10 });
      await mapIndex.addRegion(region);
      await mapIndex.removeRegion('del_r');

      const result = mapIndex.getOverview({ x: 0, z: 0, radius: 128, dimension: 'overworld' });
      expect(result.regions).toHaveLength(0);
    });
  });

  describe('getFeatureByMemoryId / getRegionByMemoryId', () => {
    it('should find feature by memory id', async () => {
      const feature = makeFeature({ id: 'f_mem', memoryId: 'mem_1', x: 0, z: 0 });
      await mapIndex.addFeature(feature);

      const found = mapIndex.getFeatureByMemoryId('mem_1');
      expect(found).toBeDefined();
      expect(found!.id).toBe('f_mem');

      const notFound = mapIndex.getFeatureByMemoryId('nonexistent');
      expect(notFound).toBeUndefined();
    });

    it('should find region by memory id', async () => {
      const region = makeRegion({ id: 'r_mem', memoryId: 'mem_2' });
      await mapIndex.addRegion(region);

      const found = mapIndex.getRegionByMemoryId('mem_2');
      expect(found).toBeDefined();
      expect(found!.id).toBe('r_mem');
    });
  });

  describe('stats', () => {
    it('should return correct statistics', async () => {
      mockSqlite.setFeatures([
        makeFeature({ id: 'f1', featureType: 'resource', dimension: 'overworld' }),
        makeFeature({ id: 'f2', featureType: 'structure', dimension: 'overworld' }),
        makeFeature({ id: 'f3', featureType: 'point', dimension: 'nether' }),
      ]);
      mockSqlite.setRegions([
        makeRegion({ id: 'r1' }),
      ]);
      await mapIndex.load();

      const stats = mapIndex.stats();
      expect(stats.totalFeatures).toBe(3);
      expect(stats.byDimension.overworld).toBe(2);
      expect(stats.byDimension.nether).toBe(1);
      expect(stats.byType.resource).toBe(1);
      expect(stats.byType.structure).toBe(1);
      expect(stats.byType.point).toBe(1);
      expect(stats.totalRegions).toBe(1);
      expect(stats.totalChunks).toBeGreaterThan(0);
      expect(stats.memorySizeBytes).toBeGreaterThan(0);
    });
  });
});