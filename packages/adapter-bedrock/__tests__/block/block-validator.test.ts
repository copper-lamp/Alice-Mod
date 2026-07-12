/**
 * BlockValidator 单元测试
 */

import { describe, it, expect, vi } from 'vitest';
import { BlockValidator } from '../../src/ai/block/BlockValidator.js';
import type { Vec3 } from '../../src/ai/pathfinding/types.js';

function createFakeWorld(blocks: Record<string, string>) {
  return {
    getBlock: vi.fn((x: number, y: number, z: number) => {
      const key = `${x},${y},${z}`;
      return { name: blocks[key] ?? 'air', pos: { x, y, z } };
    }),
  };
}

describe('BlockValidator', () => {
  const validator = new BlockValidator();

  it('findPlacementFace 应找到合法放置面', () => {
    const world = createFakeWorld({
      '0,0,0': 'stone',
      '1,0,0': 'air',
    });
    const pos: Vec3 = { x: 1, y: 0, z: 0 };
    const playerPos: Vec3 = { x: 0, y: 1, z: 0 };

    const face = validator.findPlacementFace(pos, world, playerPos);
    expect(face).not.toBeNull();
    expect(face!.face).toEqual({ x: -1, y: 0, z: 0 });
    expect(face!.neighbor).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('findPlacementFace 目标位置被占用时应返回 null', () => {
    const world = createFakeWorld({
      '0,0,0': 'stone',
      '1,0,0': 'stone',
    });
    const pos: Vec3 = { x: 1, y: 0, z: 0 };
    const playerPos: Vec3 = { x: 0, y: 1, z: 0 };

    const face = validator.findPlacementFace(pos, world, playerPos);
    expect(face).toBeNull();
  });

  it('findPlacementFace 无邻接实体方块时应返回 null', () => {
    const world = createFakeWorld({
      '1,0,0': 'air',
    });
    const pos: Vec3 = { x: 1, y: 0, z: 0 };
    const playerPos: Vec3 = { x: 0, y: 1, z: 0 };

    const face = validator.findPlacementFace(pos, world, playerPos);
    expect(face).toBeNull();
  });

  it('confirmBroken 空气方块应返回 true', () => {
    const world = createFakeWorld({ '0,0,0': 'air' });
    expect(validator.confirmBroken({ x: 0, y: 0, z: 0 }, world)).toBe(true);
  });

  it('confirmBroken 非空气方块应返回 false', () => {
    const world = createFakeWorld({ '0,0,0': 'stone' });
    expect(validator.confirmBroken({ x: 0, y: 0, z: 0 }, world)).toBe(false);
  });

  it('confirmPlaced 应匹配预期方块', () => {
    const world = createFakeWorld({ '0,0,0': 'oak_planks' });
    expect(validator.confirmPlaced({ x: 0, y: 0, z: 0 }, world, 'oak_planks')).toBe(true);
    expect(validator.confirmPlaced({ x: 0, y: 0, z: 0 }, world, 'stone')).toBe(false);
  });

  it('isReachable 应在距离范围内返回 true', () => {
    expect(validator.isReachable({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 5)).toBe(true);
    expect(validator.isReachable({ x: 3, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 5)).toBe(true);
  });

  it('isReachable 超出距离应返回 false', () => {
    expect(validator.isReachable({ x: 10, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 5)).toBe(false);
  });
});
