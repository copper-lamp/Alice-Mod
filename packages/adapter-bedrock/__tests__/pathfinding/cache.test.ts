import { describe, it, expect } from 'vitest';
import { PathCache } from '../../src/ai/pathfinding/cache.js';
import type { Path, Vec3 } from '../../src/ai/pathfinding/types.js';

function makePath(...waypoints: Vec3[]): Path {
  return {
    segments: [
      {
        mode: 'walk',
        waypoints,
        estimatedCost: 100,
      },
    ],
    totalCost: 100,
    totalDistance: 10,
    isPartial: false,
  };
}

describe('PathCache', () => {
  it('缓存并命中路径', () => {
    const cache = new PathCache(10);
    const from: Vec3 = { x: 0, y: 64, z: 0 };
    const to: Vec3 = { x: 30, y: 64, z: 0 };
    const path = makePath(from, to);

    cache.put(from, to, 0, path);
    const hit = cache.get(from, to, 0);

    expect(hit).toBe(path);
  });

  it('不同维度不会命中', () => {
    const cache = new PathCache(10);
    const from: Vec3 = { x: 0, y: 64, z: 0 };
    const to: Vec3 = { x: 30, y: 64, z: 0 };
    const path = makePath(from, to);

    cache.put(from, to, 0, path);
    const hit = cache.get(from, to, 1);

    expect(hit).toBeNull();
  });

  it('按区域失效缓存', () => {
    const cache = new PathCache(10);
    const a: Vec3 = { x: 0, y: 64, z: 0 };
    const b: Vec3 = { x: 30, y: 64, z: 0 };
    const path = makePath(a, b);

    cache.put(a, b, 0, path);
    cache.invalidate({ min: { x: -5, y: 0, z: -5 }, max: { x: 5, y: 100, z: 5 } });

    expect(cache.get(a, b, 0)).toBeNull();
    expect(cache.size()).toBe(0);
  });

  it('LRU 淘汰', () => {
    const cache = new PathCache(1);
    const a: Vec3 = { x: 0, y: 64, z: 0 };
    const b: Vec3 = { x: 30, y: 64, z: 0 };
    const c: Vec3 = { x: 100, y: 64, z: 0 };

    cache.put(a, b, 0, makePath(a, b));
    cache.put(b, c, 0, makePath(b, c));

    expect(cache.get(a, b, 0)).toBeNull();
    expect(cache.get(b, c, 0)).not.toBeNull();
  });
});
