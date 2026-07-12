/**
 * 路径缓存
 *
 * 以 Chunk 对齐的起点/终点作为 Key，缓存寻路结果。
 * 方块变化时按 Chunk 失效缓存。
 */

import type { Vec3, BoundingBox, Path } from './types.js';

interface CacheEntry {
  path: Path;
  lastAccessed: number;
}

export class PathCache {
  private cache = new Map<string, CacheEntry>();
  private maxSize: number;

  constructor(maxSize: number = 256) {
    this.maxSize = maxSize;
  }

  /**
   * 构建缓存 Key（Chunk 对齐 + 维度 + 模式）
   */
  private buildKey(from: Vec3, to: Vec3, dimid: number): string {
    const cx = Math.floor(from.x / 16);
    const cz = Math.floor(from.z / 16);
    const c2x = Math.floor(to.x / 16);
    const c2z = Math.floor(to.z / 16);
    return `${dimid}:${cx},${cz}->${c2x},${c2z}`;
  }

  /**
   * 获取缓存路径
   */
  get(from: Vec3, to: Vec3, dimid: number): Path | null {
    const key = this.buildKey(from, to, dimid);
    const entry = this.cache.get(key);
    if (!entry) return null;

    entry.lastAccessed = Date.now();
    return entry.path;
  }

  /**
   * 写入缓存
   */
  put(from: Vec3, to: Vec3, dimid: number, path: Path): void {
    if (this.cache.size >= this.maxSize) {
      this.evictLRU();
    }

    const key = this.buildKey(from, to, dimid);
    this.cache.set(key, {
      path,
      lastAccessed: Date.now(),
    });
  }

  /**
   * 按区域失效缓存
   */
  invalidate(region?: BoundingBox): void {
    if (!region) {
      this.cache.clear();
      return;
    }

    const minCx = Math.floor(region.min.x / 16);
    const minCz = Math.floor(region.min.z / 16);
    const maxCx = Math.floor(region.max.x / 16);
    const maxCz = Math.floor(region.max.z / 16);

    for (const key of this.cache.keys()) {
      // key 格式: dimid:cx,cz->c2x,c2z
      const match = key.match(/:(-?\d+),(-?\d+)->(-?\d+),(-?\d+)$/);
      if (!match) continue;

      const cx = Number(match[1]);
      const cz = Number(match[2]);
      const c2x = Number(match[3]);
      const c2z = Number(match[4]);

      const startIn = cx >= minCx && cx <= maxCx && cz >= minCz && cz <= maxCz;
      const endIn = c2x >= minCx && c2x <= maxCx && c2z >= minCz && c2z <= maxCz;

      if (startIn || endIn) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * 清空缓存
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * 获取当前缓存大小
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * LRU 淘汰
   */
  private evictLRU(): void {
    let oldestKey: string | null = null;
    let oldestTime = Number.MAX_SAFE_INTEGER;

    for (const [key, entry] of this.cache) {
      if (entry.lastAccessed < oldestTime) {
        oldestTime = entry.lastAccessed;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
    }
  }
}
