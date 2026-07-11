/**
 * MapSync — 地图特征自动同步器
 *
 * 监听 MemoryManager 的 store/update/forget 操作，
 * 当存入地图类型记忆（map_point / map_region / map_biome）时，
 * 自动创建/更新/删除空间索引。
 */

import { randomUUID } from 'node:crypto';
import { MapIndex } from './map-index';
import type { Memory, MapFeature, MapRegion, FeatureType, Dimension, RegionType } from './types';
import { MAP_MEMORY_TYPES } from './types';

export class MapSync {
  private mapIndex: MapIndex;

  constructor(mapIndex: MapIndex) {
    this.mapIndex = mapIndex;
  }

  /**
   * 监听记忆存储事件
   */
  async onMemoryStored(memory: Memory): Promise<void> {
    if (!MAP_MEMORY_TYPES.has(memory.type)) return;

    const content = memory.content as Record<string, unknown>;

    if (memory.type === 'map_region') {
      await this.syncRegion(memory, content);
    } else {
      await this.syncFeature(memory, content);
    }
  }

  /**
   * 监听记忆更新事件
   */
  async onMemoryUpdated(memory: Memory): Promise<void> {
    if (!MAP_MEMORY_TYPES.has(memory.type)) return;

    const content = memory.content as Record<string, unknown>;

    if (memory.type === 'map_region') {
      // 更新命名区域
      const existingRegion = this.mapIndex.getRegionByMemoryId(memory.id);
      if (existingRegion) {
        await this.mapIndex.updateRegion(existingRegion.id, {
          name: content.name as string,
          regionType: (content.regionType as RegionType) || existingRegion.regionType,
          x1: (content.x1 as number) ?? existingRegion.x1,
          z1: (content.z1 as number) ?? existingRegion.z1,
          x2: (content.x2 as number) ?? existingRegion.x2,
          z2: (content.z2 as number) ?? existingRegion.z2,
          dimension: (content.dimension as Dimension) || existingRegion.dimension,
          description: content.description as string,
        });
      } else {
        await this.syncRegion(memory, content);
      }
    } else {
      // 更新地图特征
      const existingFeature = this.mapIndex.getFeatureByMemoryId(memory.id);
      if (existingFeature) {
        await this.mapIndex.updateFeature(existingFeature.id, {
          featureType: (content.featureType as FeatureType) || this.getFeatureType(memory.type),
          name: content.name as string,
          x: (content.x as number) ?? existingFeature.x,
          y: (content.y as number) ?? 0,
          z: (content.z as number) ?? existingFeature.z,
          dimension: (content.dimension as Dimension) || existingFeature.dimension,
          tags: memory.tags,
          metadata: content as Record<string, unknown>,
        });
      } else {
        await this.syncFeature(memory, content);
      }
    }
  }

  /**
   * 监听记忆删除事件
   */
  async onMemoryForgotten(memoryId: string): Promise<void> {
    await this.mapIndex.removeFeatureByMemoryId(memoryId);
    await this.mapIndex.removeRegionByMemoryId(memoryId);
  }

  private async syncFeature(memory: Memory, content: Record<string, unknown>): Promise<void> {
    const feature: MapFeature = {
      id: randomUUID(),
      memoryId: memory.id,
      featureType: this.getFeatureType(memory.type),
      name: (content.name as string) || undefined,
      x: (content.x as number) ?? 0,
      y: (content.y as number) ?? 0,
      z: (content.z as number) ?? 0,
      dimension: (content.dimension as Dimension) || 'overworld',
      tags: memory.tags,
      metadata: content as Record<string, unknown>,
      updatedAt: Date.now(),
    };

    await this.mapIndex.addFeature(feature);
  }

  private async syncRegion(memory: Memory, content: Record<string, unknown>): Promise<void> {
    const region: MapRegion = {
      id: randomUUID(),
      name: (content.name as string) || 'unnamed',
      regionType: (content.regionType as RegionType) || 'custom',
      x1: (content.x1 as number) ?? 0,
      z1: (content.z1 as number) ?? 0,
      x2: (content.x2 as number) ?? 0,
      z2: (content.z2 as number) ?? 0,
      dimension: (content.dimension as string) || 'overworld',
      description: content.description as string,
      memoryId: memory.id,
      createdAt: memory.createdAt,
      updatedAt: memory.updatedAt,
    };

    await this.mapIndex.addRegion(region);
  }

  private getFeatureType(memoryType: string): FeatureType {
    switch (memoryType) {
      case 'map_point': return 'point';
      case 'map_biome': return 'biome';
      default: return 'point';
    }
  }
}