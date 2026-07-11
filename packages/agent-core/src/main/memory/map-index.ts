/**
 * MapIndex — 地图索引引擎
 *
 * 基于 Chunk 对齐网格 (16×16) 的全内存空间索引。
 * 启动时从 SQLite 全量加载，查询走内存，写入时同步写 SQLite。
 *
 * 内存索引结构：
 *   byDimension: dimension → chunkKey(chunkX:chunkZ) → Set<featureId>
 *   byId: id → MapFeature
 *   regions: id → MapRegion
 */

import { randomUUID } from 'node:crypto';
import type {
  MapFeature, MapRegion, Dimension, FeatureType,
  NearbyQueryParams, NearbyQueryResult, NearbyQueryFeature,
  AreaQueryParams, AreaQueryResult,
  OverviewParams, OverviewResult, OverviewRegion, OverviewHighlight,
  MapIndexStats,
} from './types';

// ════════════════════════════════════════════════════════════════
// 内部类型：数据库行
// ════════════════════════════════════════════════════════════════

interface MapFeatureRow {
  id: string;
  memory_id: string | null;
  feature_type: string;
  name: string | null;
  x: number;
  y: number;
  z: number;
  dimension: string;
  tags: string;
  metadata: string | null;
  updated_at: number;
}

interface MapRegionRow {
  id: string;
  name: string;
  region_type: string;
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  dimension: string;
  description: string | null;
  memory_id: string | null;
  created_at: number;
  updated_at: number;
}

// ════════════════════════════════════════════════════════════════
// 转换函数
// ════════════════════════════════════════════════════════════════

function rowToFeature(row: MapFeatureRow): MapFeature {
  return {
    id: row.id,
    memoryId: row.memory_id ?? undefined,
    featureType: row.feature_type as FeatureType,
    name: row.name ?? undefined,
    x: row.x,
    y: row.y,
    z: row.z,
    dimension: row.dimension as Dimension,
    tags: JSON.parse(row.tags) as string[],
    metadata: row.metadata ? JSON.parse(row.metadata) as Record<string, unknown> : undefined,
    updatedAt: row.updated_at,
  };
}

function featureToRow(feature: MapFeature): MapFeatureRow {
  return {
    id: feature.id,
    memory_id: feature.memoryId ?? null,
    feature_type: feature.featureType,
    name: feature.name ?? null,
    x: feature.x,
    y: feature.y,
    z: feature.z,
    dimension: feature.dimension,
    tags: JSON.stringify(feature.tags),
    metadata: feature.metadata ? JSON.stringify(feature.metadata) : null,
    updated_at: feature.updatedAt,
  };
}

function rowToRegion(row: MapRegionRow): MapRegion {
  return {
    id: row.id,
    name: row.name,
    regionType: row.region_type as MapRegion['regionType'],
    x1: row.x1,
    z1: row.z1,
    x2: row.x2,
    z2: row.z2,
    dimension: row.dimension,
    description: row.description ?? undefined,
    memoryId: row.memory_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function regionToRow(region: MapRegion): MapRegionRow {
  return {
    id: region.id,
    name: region.name,
    region_type: region.regionType,
    x1: region.x1,
    z1: region.z1,
    x2: region.x2,
    z2: region.z2,
    dimension: region.dimension,
    description: region.description ?? null,
    memory_id: region.memoryId ?? null,
    created_at: region.createdAt,
    updated_at: region.updatedAt,
  };
}

// ════════════════════════════════════════════════════════════════
// MapIndex 类
// ════════════════════════════════════════════════════════════════

export interface SQLiteExecutor {
  queryAll<T = Record<string, unknown>>(sql: string, params?: Record<string, unknown>): T[];
  run(sql: string, params?: Record<string, unknown>): void;
}

export class MapIndex {
  // 内存索引结构
  private byDimension: Map<string, Map<string, Set<string>>> = new Map();
  private byId: Map<string, MapFeature> = new Map();
  private regions: Map<string, MapRegion> = new Map();

  private sqlite: SQLiteExecutor;
  private logger: { warn: (msg: string, err?: unknown) => void; info: (msg: string) => void; error: (msg: string, err?: unknown) => void };

  constructor(
    sqlite: SQLiteExecutor,
    logger?: { warn: (msg: string, err?: unknown) => void; info: (msg: string) => void; error: (msg: string, err?: unknown) => void },
  ) {
    this.sqlite = sqlite;
    this.logger = logger ?? {
      warn: (msg) => console.warn(`[MapIndex] ${msg}`),
      info: (msg) => console.info(`[MapIndex] ${msg}`),
      error: (msg, err) => console.error(`[MapIndex] ${msg}`, err),
    };
  }

  // ══════════════════════════════════════════════════════════════
  // 初始化
  // ══════════════════════════════════════════════════════════════

  /** 全量加载地图数据到内存 */
  async load(): Promise<void> {
    const start = Date.now();

    // 1. 加载所有 map_features
    const featureRows = this.sqlite.queryAll<MapFeatureRow>('SELECT * FROM map_features');
    for (const row of featureRows) {
      const feature = rowToFeature(row);
      this.indexFeature(feature);
    }

    // 2. 加载所有 map_regions
    const regionRows = this.sqlite.queryAll<MapRegionRow>('SELECT * FROM map_regions');
    for (const row of regionRows) {
      const region = rowToRegion(row);
      this.regions.set(region.id, region);
    }

    this.logger.info(
      `MapIndex loaded: ${this.byId.size} features, ${this.regions.size} regions, ${this.countChunks()} chunks (${Date.now() - start}ms)`,
    );
  }

  /** 刷新内存索引（重新加载） */
  async refresh(): Promise<void> {
    this.byDimension.clear();
    this.byId.clear();
    this.regions.clear();
    await this.load();
  }

  private indexFeature(feature: MapFeature): void {
    this.byId.set(feature.id, feature);

    const chunkX = feature.x >> 4;
    const chunkZ = feature.z >> 4;
    const chunkKey = `${chunkX}:${chunkZ}`;

    if (!this.byDimension.has(feature.dimension)) {
      this.byDimension.set(feature.dimension, new Map());
    }
    const dimIndex = this.byDimension.get(feature.dimension)!;
    if (!dimIndex.has(chunkKey)) {
      dimIndex.set(chunkKey, new Set());
    }
    dimIndex.get(chunkKey)!.add(feature.id);
  }

  private unindexFeature(featureId: string): void {
    const feature = this.byId.get(featureId);
    if (!feature) return;

    const chunkX = feature.x >> 4;
    const chunkZ = feature.z >> 4;
    const chunkKey = `${chunkX}:${chunkZ}`;

    const dimIndex = this.byDimension.get(feature.dimension);
    if (dimIndex) {
      const chunkSet = dimIndex.get(chunkKey);
      if (chunkSet) {
        chunkSet.delete(featureId);
        if (chunkSet.size === 0) {
          dimIndex.delete(chunkKey);
        }
      }
      if (dimIndex.size === 0) {
        this.byDimension.delete(feature.dimension);
      }
    }

    this.byId.delete(featureId);
  }

  private countChunks(): number {
    let count = 0;
    for (const dimIndex of this.byDimension.values()) {
      count += dimIndex.size;
    }
    return count;
  }

  // ══════════════════════════════════════════════════════════════
  // 查询
  // ══════════════════════════════════════════════════════════════

  /** 邻近查询 */
  queryNearby(params: NearbyQueryParams): NearbyQueryResult {
    const { x, z, radius, dimension, type, limit = 50 } = params;

    const dimIndex = this.byDimension.get(dimension);
    if (!dimIndex) {
      return { features: [], count: 0, center: { x, z }, radius };
    }

    // 1. 计算 Chunk 范围
    const minChunkX = Math.floor((x - radius) / 16);
    const maxChunkX = Math.floor((x + radius) / 16);
    const minChunkZ = Math.floor((z - radius) / 16);
    const maxChunkZ = Math.floor((z + radius) / 16);

    // 2. 收集候选特征 ID
    const candidateIds = new Set<string>();
    for (let cx = minChunkX; cx <= maxChunkX; cx++) {
      for (let cz = minChunkZ; cz <= maxChunkZ; cz++) {
        const chunkKey = `${cx}:${cz}`;
        const features = dimIndex.get(chunkKey);
        if (features) {
          for (const id of features) {
            candidateIds.add(id);
          }
        }
      }
    }

    // 3. 精确距离过滤 + 类型筛选 + 排序
    const radiusSq = radius * radius;
    const results: Array<{ feature: MapFeature; distance: number }> = [];

    for (const id of candidateIds) {
      const feature = this.byId.get(id);
      if (!feature) continue;
      if (type && feature.featureType !== type) continue;

      const dx = feature.x - x;
      const dz = feature.z - z;
      const distSq = dx * dx + dz * dz;

      if (distSq <= radiusSq) {
        results.push({ feature, distance: Math.sqrt(distSq) });
      }
    }

    // 4. 按距离排序
    results.sort((a, b) => a.distance - b.distance);

    // 5. 取 limit 条
    const top = results.slice(0, limit);

    const features: NearbyQueryFeature[] = top.map(r => ({
      id: r.feature.id,
      name: r.feature.name,
      featureType: r.feature.featureType,
      x: r.feature.x,
      y: r.feature.y,
      z: r.feature.z,
      tags: r.feature.tags,
      distance: Math.round(r.distance * 100) / 100,
    }));

    return { features, count: features.length, center: { x, z }, radius };
  }

  /** 矩形区域查询 */
  queryArea(params: AreaQueryParams): AreaQueryResult {
    const { x1, z1, x2, z2, dimension, type, limit = 50, offset = 0 } = params;

    const dimIndex = this.byDimension.get(dimension);
    if (!dimIndex) {
      return { features: [], count: 0, total: 0, bounds: { x1, z1, x2, z2 } };
    }

    const minX = Math.min(x1, x2);
    const maxX = Math.max(x1, x2);
    const minZ = Math.min(z1, z2);
    const maxZ = Math.max(z1, z2);

    // 计算 Chunk 范围
    const minChunkX = Math.floor(minX / 16);
    const maxChunkX = Math.floor(maxX / 16);
    const minChunkZ = Math.floor(minZ / 16);
    const maxChunkZ = Math.floor(maxZ / 16);

    const candidateIds = new Set<string>();
    for (let cx = minChunkX; cx <= maxChunkX; cx++) {
      for (let cz = minChunkZ; cz <= maxChunkZ; cz++) {
        const chunkKey = `${cx}:${cz}`;
        const features = dimIndex.get(chunkKey);
        if (features) {
          for (const id of features) {
            candidateIds.add(id);
          }
        }
      }
    }

    // 精确矩形过滤
    const matched: MapFeature[] = [];
    for (const id of candidateIds) {
      const feature = this.byId.get(id);
      if (!feature) continue;
      if (type && feature.featureType !== type) continue;
      if (feature.x >= minX && feature.x <= maxX && feature.z >= minZ && feature.z <= maxZ) {
        matched.push(feature);
      }
    }

    const total = matched.length;
    const paged = matched.slice(offset, offset + limit);

    return {
      features: paged,
      count: paged.length,
      total,
      bounds: { x1: minX, z1: minZ, x2: maxX, z2: maxZ },
    };
  }

  /** 区域概览 */
  getOverview(params: OverviewParams): OverviewResult {
    const { x, z, radius, dimension } = params;

    const x1 = x - radius;
    const z1 = z - radius;
    const x2 = x + radius;
    const z2 = z + radius;

    // 查询区域内所有特征
    const areaResult = this.queryArea({
      x1, z1, x2, z2, dimension, limit: 10000,
    });

    const features = areaResult.features;

    // 特征统计
    const featureStats: Record<string, number> = {};
    for (const f of features) {
      featureStats[f.featureType] = (featureStats[f.featureType] || 0) + 1;
    }

    // 查找重叠的命名区域
    const overlappingRegions: OverviewRegion[] = [];
    for (const region of this.regions.values()) {
      if (region.dimension !== dimension) continue;
      // 检查矩形重叠
      if (region.x1 <= x2 && region.x2 >= x1 && region.z1 <= z2 && region.z2 >= z1) {
        overlappingRegions.push({
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

    // 提取关键点（高重要度标签）
    const highlights: OverviewHighlight[] = features
      .filter(f => f.tags.includes('important') || f.tags.includes('hot'))
      .slice(0, 5)
      .map(f => ({
        name: f.name,
        featureType: f.featureType,
        x: f.x,
        z: f.z,
      }));

    // 如果没有 tagged 特征，取距离中心最近的 3 个
    if (highlights.length === 0 && features.length > 0) {
      const sorted = [...features].sort((a, b) => {
        const da = (a.x - x) * (a.x - x) + (a.z - z) * (a.z - z);
        const db = (b.x - x) * (b.x - x) + (b.z - z) * (b.z - z);
        return da - db;
      });
      for (const f of sorted.slice(0, 3)) {
        highlights.push({
          name: f.name,
          featureType: f.featureType,
          x: f.x,
          z: f.z,
        });
      }
    }

    // 构建摘要
    const summary = this.buildSummary(
      features, overlappingRegions,
      { x1: x - radius, z1: z - radius, x2: x + radius, z2: z + radius },
      dimension,
    );

    return {
      summary,
      featureStats,
      regions: overlappingRegions,
      highlights,
      bounds: { x1: x - radius, z1: z - radius, x2: x + radius, z2: z + radius },
    };
  }

  private buildSummary(
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
    const stats: Record<string, number> = {};
    for (const f of features) {
      stats[f.featureType] = (stats[f.featureType] || 0) + 1;
    }
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

  // ══════════════════════════════════════════════════════════════
  // 写入
  // ══════════════════════════════════════════════════════════════

  /** 添加特征 */
  async addFeature(feature: MapFeature): Promise<void> {
    const row = featureToRow(feature);
    this.sqlite.run(
      `INSERT INTO map_features (id, memory_id, feature_type, name, x, y, z, dimension, tags, metadata, updated_at)
       VALUES (@id, @memory_id, @feature_type, @name, @x, @y, @z, @dimension, @tags, @metadata, @updated_at)`,
      row as unknown as Record<string, unknown>,
    );

    // 写入空间网格
    this.sqlite.run(
      `INSERT OR IGNORE INTO map_spatial_grid (chunk_x, chunk_z, dimension, feature_id)
       VALUES (@chunk_x, @chunk_z, @dimension, @feature_id)`,
      {
        chunk_x: feature.x >> 4,
        chunk_z: feature.z >> 4,
        dimension: feature.dimension,
        feature_id: feature.id,
      },
    );

    // 更新内存索引
    this.indexFeature(feature);
  }

  /** 更新特征 */
  async updateFeature(id: string, updates: Partial<MapFeature>): Promise<void> {
    const existing = this.byId.get(id);
    if (!existing) return;

    // 如果坐标变化，需要重新计算 Chunk 索引
    const coordsChanged = updates.x !== undefined || updates.z !== undefined;

    if (coordsChanged) {
      this.unindexFeature(id);
    }

    const merged: MapFeature = { ...existing, ...updates, id };

    // 构建更新 SQL
    const setClauses: string[] = [];
    const bindings: Record<string, unknown> = { id };

    if (updates.featureType !== undefined) { setClauses.push('feature_type = @feature_type'); bindings.feature_type = updates.featureType; }
    if (updates.name !== undefined) { setClauses.push('name = @name'); bindings.name = updates.name; }
    if (updates.x !== undefined) { setClauses.push('x = @x'); bindings.x = updates.x; }
    if (updates.y !== undefined) { setClauses.push('y = @y'); bindings.y = updates.y; }
    if (updates.z !== undefined) { setClauses.push('z = @z'); bindings.z = updates.z; }
    if (updates.dimension !== undefined) { setClauses.push('dimension = @dimension'); bindings.dimension = updates.dimension; }
    if (updates.tags !== undefined) { setClauses.push('tags = @tags'); bindings.tags = JSON.stringify(updates.tags); }
    if (updates.metadata !== undefined) { setClauses.push('metadata = @metadata'); bindings.metadata = JSON.stringify(updates.metadata); }
    setClauses.push('updated_at = @updated_at');
    bindings.updated_at = Date.now();

    if (setClauses.length > 1) {
      this.sqlite.run(
        `UPDATE map_features SET ${setClauses.join(', ')} WHERE id = @id`,
        bindings,
      );
    }

    // 如果坐标变化，更新空间网格
    if (coordsChanged) {
      // 删除旧网格
      this.sqlite.run(
        'DELETE FROM map_spatial_grid WHERE feature_id = @feature_id',
        { feature_id: id },
      );
      // 插入新网格
      this.sqlite.run(
        `INSERT OR IGNORE INTO map_spatial_grid (chunk_x, chunk_z, dimension, feature_id)
         VALUES (@chunk_x, @chunk_z, @dimension, @feature_id)`,
        {
          chunk_x: merged.x >> 4,
          chunk_z: merged.z >> 4,
          dimension: merged.dimension,
          feature_id: id,
        },
      );
    }

    // 更新内存索引
    if (coordsChanged) {
      this.indexFeature(merged);
    } else {
      this.byId.set(id, merged);
    }
  }

  /** 删除特征 */
  async removeFeature(id: string): Promise<void> {
    // 删除网格记录（CASCADE 会自动处理，但显式删除更安全）
    this.sqlite.run('DELETE FROM map_spatial_grid WHERE feature_id = @feature_id', { feature_id: id });
    this.sqlite.run('DELETE FROM map_features WHERE id = @id', { id });

    // 更新内存索引
    this.unindexFeature(id);
  }

  /** 添加命名区域 */
  async addRegion(region: MapRegion): Promise<void> {
    const row = regionToRow(region);
    this.sqlite.run(
      `INSERT INTO map_regions (id, name, region_type, x1, z1, x2, z2, dimension, description, memory_id, created_at, updated_at)
       VALUES (@id, @name, @region_type, @x1, @z1, @x2, @z2, @dimension, @description, @memory_id, @created_at, @updated_at)`,
      row as unknown as Record<string, unknown>,
    );

    this.regions.set(region.id, region);
  }

  /** 更新命名区域 */
  async updateRegion(id: string, updates: Partial<MapRegion>): Promise<void> {
    const existing = this.regions.get(id);
    if (!existing) return;

    const merged: MapRegion = { ...existing, ...updates, id };

    const setClauses: string[] = [];
    const bindings: Record<string, unknown> = { id };

    if (updates.name !== undefined) { setClauses.push('name = @name'); bindings.name = updates.name; }
    if (updates.regionType !== undefined) { setClauses.push('region_type = @region_type'); bindings.region_type = updates.regionType; }
    if (updates.x1 !== undefined) { setClauses.push('x1 = @x1'); bindings.x1 = updates.x1; }
    if (updates.z1 !== undefined) { setClauses.push('z1 = @z1'); bindings.z1 = updates.z1; }
    if (updates.x2 !== undefined) { setClauses.push('x2 = @x2'); bindings.x2 = updates.x2; }
    if (updates.z2 !== undefined) { setClauses.push('z2 = @z2'); bindings.z2 = updates.z2; }
    if (updates.description !== undefined) { setClauses.push('description = @description'); bindings.description = updates.description; }
    setClauses.push('updated_at = @updated_at');
    bindings.updated_at = Date.now();

    if (setClauses.length > 1) {
      this.sqlite.run(
        `UPDATE map_regions SET ${setClauses.join(', ')} WHERE id = @id`,
        bindings,
      );
    }

    this.regions.set(id, merged);
  }

  /** 删除命名区域 */
  async removeRegion(id: string): Promise<void> {
    this.sqlite.run('DELETE FROM map_regions WHERE id = @id', { id });
    this.regions.delete(id);
  }

  /** 根据 memory_id 查询特征 */
  getFeatureByMemoryId(memoryId: string): MapFeature | undefined {
    for (const feature of this.byId.values()) {
      if (feature.memoryId === memoryId) {
        return feature;
      }
    }
    return undefined;
  }

  /** 根据 memory_id 查询区域 */
  getRegionByMemoryId(memoryId: string): MapRegion | undefined {
    for (const region of this.regions.values()) {
      if (region.memoryId === memoryId) {
        return region;
      }
    }
    return undefined;
  }

  /** 根据 memory_id 删除特征 */
  async removeFeatureByMemoryId(memoryId: string): Promise<void> {
    const feature = this.getFeatureByMemoryId(memoryId);
    if (feature) {
      await this.removeFeature(feature.id);
    }
  }

  /** 根据 memory_id 删除区域 */
  async removeRegionByMemoryId(memoryId: string): Promise<void> {
    const region = this.getRegionByMemoryId(memoryId);
    if (region) {
      await this.removeRegion(region.id);
    }
  }

  // ══════════════════════════════════════════════════════════════
  // 统计
  // ══════════════════════════════════════════════════════════════

  stats(): MapIndexStats {
    const byDimension: Partial<Record<Dimension, number>> = {};
    const byType: Partial<Record<FeatureType, number>> = {};

    for (const feature of this.byId.values()) {
      byDimension[feature.dimension] = (byDimension[feature.dimension] || 0) + 1;
      byType[feature.featureType] = (byType[feature.featureType] || 0) + 1;
    }

    // 估算内存占用
    const memorySizeBytes = this.estimateMemorySize();

    return {
      totalFeatures: this.byId.size,
      byDimension,
      byType,
      totalRegions: this.regions.size,
      totalChunks: this.countChunks(),
      memorySizeBytes,
    };
  }

  private estimateMemorySize(): number {
    let size = 0;
    // byDimension 结构开销
    for (const dimIndex of this.byDimension.values()) {
      for (const [chunkKey, featureSet] of dimIndex) {
        size += chunkKey.length * 2; // 字符串
        size += 8; // Map 条目
        size += featureSet.size * 8; // Set 条目
      }
    }
    // 特征对象
    size += this.byId.size * 200;
    // 区域
    size += this.regions.size * 200;
    return size;
  }
}