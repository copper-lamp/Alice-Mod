import { describe, it, expect } from 'vitest';
import { MovementRouter } from '../../src/ai/pathfinding/router.js';
import type { PathContext, Vec3 } from '../../src/ai/pathfinding/types.js';

function makeContext(options: Partial<PathContext['options']> = {}, hunger = 20): PathContext {
  return {
    player: {},
    playerHealth: 20,
    playerHunger: hunger,
    playerPos: { x: 0, y: 64, z: 0 },
    playerDimid: 0,
    inventory: [],
    dimension: '0',
    hostileEntities: [],
    options: {
      timeout: 30000,
      avoidHostile: false,
      allowSprint: true,
      allowBreak: false,
      allowPlace: false,
      allowSwim: true,
      allowElytra: true,
      maxBlocksToBreak: 8,
      maxBlocksToPlace: 8,
      preferredBlock: 'dirt',
      maxRange: 128,
      pathfinding: 'astar',
      ...options,
    },
  };
}

describe('MovementRouter', () => {
  const router = new MovementRouter();

  it('短距离返回 walk', () => {
    const from: Vec3 = { x: 0, y: 64, z: 0 };
    const to: Vec3 = { x: 5, y: 64, z: 0 };
    expect(router.selectMode(from, to, makeContext())).toBe('walk');
  });

  it('中长距离且允许疾跑时返回 sprint', () => {
    const from: Vec3 = { x: 0, y: 64, z: 0 };
    const to: Vec3 = { x: 20, y: 64, z: 0 };
    expect(router.selectMode(from, to, makeContext())).toBe('sprint');
  });

  it('饥饿不足时禁用疾跑', () => {
    const from: Vec3 = { x: 0, y: 64, z: 0 };
    const to: Vec3 = { x: 20, y: 64, z: 0 };
    expect(router.selectMode(from, to, makeContext({}, 5))).toBe('walk');
  });

  it('拥有鞘翅和烟花且距离足够远时触发 elytra', () => {
    const from: Vec3 = { x: 0, y: 100, z: 0 };
    const to: Vec3 = { x: 200, y: 100, z: 0 };
    const ctx = makeContext({}, 20);
    ctx.inventory = [
      { name: 'elytra', count: 1, slot: 0 },
      { name: 'firework_rocket', count: 64, slot: 1 },
    ];
    expect(router.selectMode(from, to, ctx)).toBe('elytra');
  });

  it('垂直落差大时不触发 elytra', () => {
    const from: Vec3 = { x: 0, y: 100, z: 0 };
    const to: Vec3 = { x: 200, y: 10, z: 0 };
    const ctx = makeContext({}, 20);
    ctx.inventory = [
      { name: 'elytra', count: 1, slot: 0 },
      { name: 'firework_rocket', count: 64, slot: 1 },
    ];
    expect(router.selectMode(from, to, ctx)).not.toBe('elytra');
  });
});
