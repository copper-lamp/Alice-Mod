/**
 * AreaPlanner 单元测试
 */

import { describe, it, expect, vi } from 'vitest';
import { AreaPlanner } from '../../src/ai/block/AreaPlanner.js';
import type { Vec3 } from '../../src/ai/pathfinding/types.js';

function createFakeWorld(blocks: Record<string, string>) {
  return {
    getBlock: vi.fn((x: number, y: number, z: number) => {
      const key = `${x},${y},${z}`;
      return { name: blocks[key] ?? 'air', pos: { x, y, z } };
    }),
  };
}

describe('AreaPlanner', () => {
  it('buildQueue fill 应生成长方体区域队列', () => {
    const world = createFakeWorld({});
    const planner = new AreaPlanner(world);
    const from: Vec3 = { x: 0, y: 0, z: 0 };
    const to: Vec3 = { x: 1, y: 1, z: 1 };

    const queue = planner.buildQueue('fill', from, to);
    expect(queue.length).toBe(8);
    expect(queue[0]).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('buildQueue clear 应使用相同区域队列', () => {
    const world = createFakeWorld({});
    const planner = new AreaPlanner(world);
    const from: Vec3 = { x: 0, y: 0, z: 0 };
    const to: Vec3 = { x: 2, y: 0, z: 0 };

    const queue = planner.buildQueue('clear', from, to);
    expect(queue.length).toBe(3);
  });

  it('buildQueue vein 应 BFS 搜索相连同类型方块', () => {
    const world = createFakeWorld({
      '0,0,0': 'coal_ore',
      '1,0,0': 'coal_ore',
      '2,0,0': 'coal_ore',
      '0,1,0': 'coal_ore',
      '3,0,0': 'stone',
    });
    const planner = new AreaPlanner(world);
    const from: Vec3 = { x: 0, y: 0, z: 0 };

    const queue = planner.buildQueue('vein', from, undefined, undefined, 8);
    expect(queue.length).toBe(4);
  });

  it('buildQueue vein 应受半径限制', () => {
    const world = createFakeWorld({
      '0,0,0': 'coal_ore',
      '5,0,0': 'coal_ore',
    });
    const planner = new AreaPlanner(world);
    const from: Vec3 = { x: 0, y: 0, z: 0 };

    const queue = planner.buildQueue('vein', from, undefined, undefined, 3);
    expect(queue.length).toBe(1);
  });

  it('checkVolumeLimit 应正确判断体积上限', () => {
    const world = createFakeWorld({});
    const planner = new AreaPlanner(world);

    const ok = planner.checkVolumeLimit(100);
    expect(ok.ok).toBe(true);

    const tooLarge = planner.checkVolumeLimit(1000);
    expect(tooLarge.ok).toBe(false);
    expect(tooLarge.max).toBe(256);
  });
});
