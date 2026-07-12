/**
 * BedFinder 单元测试
 */

import { describe, it, expect, vi } from 'vitest';
import { BedFinder, isBed } from '../../src/ai/survival/BedFinder.js';
import type { WorldAccess } from '../../src/registry/tool-module.types.js';
import type { Vec3 } from '../../src/ai/pathfinding/types.js';

function createFakeWorld(blocks: Record<string, string>): WorldAccess {
  return {
    getBlock: vi.fn((x: number, y: number, z: number) => {
      const key = `${x},${y},${z}`;
      const name = blocks[key] ?? 'air';
      return { name, pos: { x, y, z } };
    }),
    getTime: vi.fn(() => 18000),
    getWeather: vi.fn(() => 'clear'),
    getEntities: vi.fn(() => []),
    getOnlinePlayers: vi.fn(() => []),
  };
}

function createFakePlayer(overrides: Partial<any> = {}): any {
  return {
    pos: { x: 0, y: 64, z: 0 },
    isSleeping: vi.fn(() => false),
    ...overrides,
  };
}

describe('BedFinder', () => {
  it('isBed 应正确识别床方块', () => {
    expect(isBed('white_bed')).toBe(true);
    expect(isBed('minecraft:red_bed')).toBe(true);
    expect(isBed('stone')).toBe(false);
    expect(isBed('air')).toBe(false);
  });

  it('findNearest 应在半径内找到最近的床', () => {
    const world = createFakeWorld({
      '5,64,5': 'white_bed',
      '10,64,10': 'red_bed',
    });
    const finder = new BedFinder(world);
    const bed = finder.findNearest({ x: 0, y: 64, z: 0 }, 16);

    expect(bed).not.toBeNull();
    expect(bed!.pos).toEqual({ x: 5, y: 64, z: 5 });
    expect(bed!.block.name).toBe('white_bed');
  });

  it('findNearest 应返回 null 当半径内无床', () => {
    const world = createFakeWorld({
      '20,64,20': 'white_bed',
    });
    const finder = new BedFinder(world);
    const bed = finder.findNearest({ x: 0, y: 64, z: 0 }, 8);

    expect(bed).toBeNull();
  });

  it('checkSleepConditions 在夜晚无怪物时应通过', () => {
    const world = createFakeWorld({ '2,64,2': 'white_bed' });
    world.getTime = vi.fn(() => 18000); // 夜晚
    const finder = new BedFinder(world);
    const player = createFakePlayer();

    const result = finder.checkSleepConditions({ x: 2, y: 64, z: 2 }, player);
    expect(result.ok).toBe(true);
  });

  it('checkSleepConditions 在白天应失败', () => {
    const world = createFakeWorld({ '2,64,2': 'white_bed' });
    world.getTime = vi.fn(() => 6000); // 白天
    const finder = new BedFinder(world);
    const player = createFakePlayer();

    const result = finder.checkSleepConditions({ x: 2, y: 64, z: 2 }, player);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('NOT_SLEEP_TIME');
  });

  it('checkSleepConditions 附近怪物时应失败', () => {
    const world = createFakeWorld({ '2,64,2': 'white_bed' });
    world.getTime = vi.fn(() => 18000);
    world.getEntities = vi.fn(() => [
      { type: 'zombie', pos: { x: 2, y: 64, z: 3 } },
    ]);
    const finder = new BedFinder(world);
    const player = createFakePlayer();

    const result = finder.checkSleepConditions({ x: 2, y: 64, z: 2 }, player);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('MONSTERS_NEARBY');
  });
});
