/**
 * MapSync 单元测试
 *
 * 测试自动同步器：
 * - 存储 map_point 记忆时自动创建 MapFeature
 * - 存储 map_region 记忆时自动创建 MapRegion
 * - 存储非地图记忆时不创建空间索引
 * - 删除地图记忆时同步删除空间索引
 * - 更新地图记忆时同步更新空间索引
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MapIndex } from '../../src/main/memory/map-index';
import { MapSync } from '../../src/main/memory/map-sync';
import type { Memory, MapFeature, MapRegion } from '../../src/main/memory/types';

// ════════════════════════════════════════════════════════════════
// Mock SQLiteExecutor
// ════════════════════════════════════════════════════════════════

class MockSQLiteExecutor {
  private features: MapFeature[] = [];
  private regions: MapRegion[] = [];

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

function makeMemory(overrides: Partial<Memory>): Memory {
  return {
    id: overrides.id ?? 'mem_1',
    workspaceId: overrides.workspaceId ?? 'test',
    type: overrides.type ?? 'player_habit',
    branch: overrides.branch ?? 'experience',
    content: overrides.content ?? {},
    tags: overrides.tags ?? [],
    importance: overrides.importance ?? 5,
    accessCount: 0,
    embeddingId: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    expiresAt: null,
  };
}

// ════════════════════════════════════════════════════════════════
// 测试
// ════════════════════════════════════════════════════════════════

describe('MapSync', () => {
  let mockSqlite: MockSQLiteExecutor;
  let mapIndex: MapIndex;
  let mapSync: MapSync;

  beforeEach(async () => {
    mockSqlite = new MockSQLiteExecutor();
    mapIndex = new MapIndex(mockSqlite, {
      info: () => {},
      warn: () => {},
      error: () => {},
    });
    mapSync = new MapSync(mapIndex);
    await mapIndex.load();
  });

  describe('onMemoryStored', () => {
    it('should create MapFeature for map_point memory', async () => {
      const memory = makeMemory({
        id: 'mem_point',
        type: 'map_point',
        content: { x: 100, y: 64, z: 200, dimension: 'overworld', name: '钻石矿' },
        tags: ['important', 'resource'],
      });

      await mapSync.onMemoryStored(memory);

      const feature = mapIndex.getFeatureByMemoryId('mem_point');
      expect(feature).toBeDefined();
      expect(feature!.featureType).toBe('point');
      expect(feature!.x).toBe(100);
      expect(feature!.z).toBe(200);
      expect(feature!.tags).toContain('important');

      // 验证可查询
      const result = mapIndex.queryNearby({ x: 100, z: 200, radius: 16, dimension: 'overworld' });
      expect(result.features).toHaveLength(1);
    });

    it('should create MapRegion for map_region memory', async () => {
      const memory = makeMemory({
        id: 'mem_region',
        type: 'map_region',
        content: { name: '主基地', regionType: 'base', x1: 0, z1: 0, x2: 100, z2: 100, dimension: 'overworld' },
      });

      await mapSync.onMemoryStored(memory);

      const region = mapIndex.getRegionByMemoryId('mem_region');
      expect(region).toBeDefined();
      expect(region!.name).toBe('主基地');
      expect(region!.regionType).toBe('base');

      // 验证可查询
      const overview = mapIndex.getOverview({ x: 50, z: 50, radius: 128, dimension: 'overworld' });
      expect(overview.regions).toHaveLength(1);
    });

    it('should create MapFeature for map_biome memory', async () => {
      const memory = makeMemory({
        id: 'mem_biome',
        type: 'map_biome',
        content: { x: -200, y: 64, z: -300, dimension: 'overworld', name: '丛林' },
      });

      await mapSync.onMemoryStored(memory);

      const feature = mapIndex.getFeatureByMemoryId('mem_biome');
      expect(feature).toBeDefined();
      expect(feature!.featureType).toBe('biome');
    });

    it('should NOT create index for non-map memory', async () => {
      const memory = makeMemory({
        id: 'mem_habit',
        type: 'player_habit',
        content: { preference: 'night' },
      });

      await mapSync.onMemoryStored(memory);

      const feature = mapIndex.getFeatureByMemoryId('mem_habit');
      expect(feature).toBeUndefined();
    });
  });

  describe('onMemoryUpdated', () => {
    it('should update feature coordinates when memory content changes', async () => {
      const memory = makeMemory({
        id: 'mem_move',
        type: 'map_point',
        content: { x: 0, y: 64, z: 0, dimension: 'overworld' },
      });
      await mapSync.onMemoryStored(memory);

      // 更新坐标
      const updated = makeMemory({
        ...memory,
        content: { x: 200, y: 64, z: 200, dimension: 'overworld' },
      });
      await mapSync.onMemoryUpdated(updated);

      // 旧坐标不再有特征
      const nearOld = mapIndex.queryNearby({ x: 0, z: 0, radius: 16, dimension: 'overworld' });
      expect(nearOld.features).toHaveLength(0);

      // 新坐标有特征
      const nearNew = mapIndex.queryNearby({ x: 200, z: 200, radius: 16, dimension: 'overworld' });
      expect(nearNew.features).toHaveLength(1);
    });
  });

  describe('onMemoryForgotten', () => {
    it('should remove feature when memory is forgotten', async () => {
      const memory = makeMemory({
        id: 'mem_del',
        type: 'map_point',
        content: { x: 42, y: 64, z: 100, dimension: 'overworld' },
      });
      await mapSync.onMemoryStored(memory);

      expect(mapIndex.getFeatureByMemoryId('mem_del')).toBeDefined();

      await mapSync.onMemoryForgotten('mem_del');

      expect(mapIndex.getFeatureByMemoryId('mem_del')).toBeUndefined();

      const result = mapIndex.queryNearby({ x: 42, z: 100, radius: 16, dimension: 'overworld' });
      expect(result.features).toHaveLength(0);
    });

    it('should remove region when memory is forgotten', async () => {
      const memory = makeMemory({
        id: 'mem_del_region',
        type: 'map_region',
        content: { name: '待删除', regionType: 'custom', x1: 0, z1: 0, x2: 50, z2: 50, dimension: 'overworld' },
      });
      await mapSync.onMemoryStored(memory);

      expect(mapIndex.getRegionByMemoryId('mem_del_region')).toBeDefined();

      await mapSync.onMemoryForgotten('mem_del_region');

      expect(mapIndex.getRegionByMemoryId('mem_del_region')).toBeUndefined();
    });
  });
});