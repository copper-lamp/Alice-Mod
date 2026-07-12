import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BlockInteractionPlanner } from '../../src/ai/pathfinding/block-interaction-planner.js';
import type { BlockInteractionOptions, Vec3, WorldAccess } from '../../src/ai/pathfinding/types.js';

describe('BlockInteractionPlanner', () => {
  let planner: BlockInteractionPlanner;
  let blocks: Map<string, string>;

  beforeEach(() => {
    planner = new BlockInteractionPlanner();
    blocks = new Map();
    // @ts-ignore
    global.mc = {
      getBlock: (x: number, y: number, z: number, _dimid: number) => {
        const name = blocks.get(`${x},${y},${z}`);
        return name ? { name, type: name } : null;
      },
    };
  });

  afterEach(() => {
    // @ts-ignore
    delete global.mc;
  });

  function options(overrides: Partial<BlockInteractionOptions> = {}): BlockInteractionOptions {
    return {
      allowBreak: true,
      allowPlace: true,
      maxBlocksToBreak: 8,
      maxBlocksToPlace: 8,
      preferredBlock: 'dirt',
      unbreakableBlocks: new Set(['bedrock']),
      protectedBlocks: new Set(['chest']),
      ...overrides,
    };
  }

  it('前方被阻挡时生成挖掘动作', () => {
    const from: Vec3 = { x: 0, y: 64, z: 0 };
    const to: Vec3 = { x: 3, y: 64, z: 0 };
    blocks.set('1,64,0', 'stone');

    const actions = planner.generateActions(from, to, {} as WorldAccess, options());
    const breakActions = actions.filter((a) => a.type === 'break');

    expect(breakActions.length).toBeGreaterThan(0);
    expect(breakActions.some((a) => a.targetPos.x === 1 && a.targetPos.y === 64 && a.targetPos.z === 0)).toBe(true);
  });

  it('不会挖掘不可破坏方块', () => {
    const from: Vec3 = { x: 0, y: 64, z: 0 };
    const to: Vec3 = { x: 2, y: 64, z: 0 };
    blocks.set('1,64,0', 'bedrock');

    const actions = planner.generateActions(from, to, {} as WorldAccess, options());
    const breakActions = actions.filter((a) => a.type === 'break' && a.targetPos.x === 1);

    expect(breakActions.length).toBe(0);
  });

  it('跨越沟壑时生成搭桥动作', () => {
    const from: Vec3 = { x: 0, y: 64, z: 0 };
    const to: Vec3 = { x: 4, y: 64, z: 0 };

    const actions = planner.generateActions(from, to, {} as WorldAccess, options());
    const placeActions = actions.filter((a) => a.type === 'place');

    expect(placeActions.length).toBeGreaterThan(0);
  });

  it('禁止放置时不生成搭桥动作', () => {
    const from: Vec3 = { x: 0, y: 64, z: 0 };
    const to: Vec3 = { x: 4, y: 64, z: 0 };

    const actions = planner.generateActions(from, to, {} as WorldAccess, options({ allowPlace: false }));
    expect(actions.every((a) => a.type !== 'place')).toBe(true);
  });
});
