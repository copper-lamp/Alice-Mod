/**
 * 地图工具测试
 *
 * 测试 map_query_nearby 和 map_get_overview 工具的执行函数。
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MapIndex } from '../../src/main/memory/map-index';
import { mapQueryNearby } from '../../src/main/memory/tools/map_query_nearby';
import { mapGetOverview } from '../../src/main/memory/tools/map_get_overview';
import type { MapFeature, MapRegion } from '../../src/main/memory/types';

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

  run(_sql: string, _params?: Record<string, unknown>): void {}
}

function makeFeature(overrides: Partial<MapFeature>): MapFeature {
  return {
    id: overrides.id ?? 'f1',
    featureType: overrides.featureType ?? 'point',
    x: overrides.x ?? 0,
    y: overrides.y ?? 0,
    z: overrides.z ?? 0,
    dimension: overrides.dimension ?? 'overworld',
    tags: overrides.tags ?? [],
    updatedAt: Date.now(),
  };
}

describe('地图工具', () => {
  let mockSqlite: MockSQLiteExecutor;
  let mapIndex: MapIndex;

  beforeEach(async () => {
    mockSqlite = new MockSQLiteExecutor();
    mapIndex = new MapIndex(mockSqlite, {
      info: () => {}, warn: () => {}, error: () => {},
    });
    await mapIndex.load();
  });

  describe('map_query_nearby', () => {
    it('should return features within radius', async () => {
      await mapIndex.addFeature(makeFeature({ id: 'f1', x: 10, z: 10, dimension: 'overworld' }));

      const result = await mapQueryNearby(mapIndex, {
        x: 0, z: 0, radius: 64, dimension: 'overworld',
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      const data = result.data as any;
      expect(data.features).toHaveLength(1);
    });

    it('should handle empty results', async () => {
      const result = await mapQueryNearby(mapIndex, {
        x: 0, z: 0, radius: 64, dimension: 'overworld',
      });

      expect(result.success).toBe(true);
      const data = result.data as any;
      expect(data.features).toHaveLength(0);
      expect(data.count).toBe(0);
    });

    it('should handle invalid parameters gracefully', async () => {
      const result = await mapQueryNearby(mapIndex, {
        x: 0, z: 0, radius: 64, dimension: 'invalid_dimension',
      });

      expect(result.success).toBe(true);
      const data = result.data as any;
      expect(data.features).toHaveLength(0);
    });
  });

  describe('map_get_overview', () => {
    it('should return overview with summary', async () => {
      await mapIndex.addFeature(makeFeature({ id: 'f1', x: 0, z: 0, featureType: 'resource', dimension: 'overworld' }));

      const result = await mapGetOverview(mapIndex, {
        x: 0, z: 0, radius: 128, dimension: 'overworld',
      });

      expect(result.success).toBe(true);
      const data = result.data as any;
      expect(data.summary).toBeTruthy();
      expect(data.featureStats).toBeTruthy();
    });

    it('should handle empty overview', async () => {
      const result = await mapGetOverview(mapIndex, {
        x: 0, z: 0, radius: 128, dimension: 'overworld',
      });

      expect(result.success).toBe(true);
      const data = result.data as any;
      expect(data.summary).toContain('特征: 无');
    });
  });
});