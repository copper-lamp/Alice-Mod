import { describe, it, expect } from 'vitest';
import { PathfindingEngine } from '../../src/ai/pathfinding/engine.js';
import type { Vec3, PathContext, PathResult, IGroundPathPlanner, IFlightSegmentPlanner, IBlockInteractionPlanner, MoveSegment } from '../../src/ai/pathfinding/types.js';

function makeContext(overrides: Partial<PathContext> = {}): PathContext {
  return {
    player: {},
    playerHealth: 20,
    playerHunger: 20,
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
    },
    ...overrides,
  };
}

class FakeGroundPlanner implements IGroundPathPlanner {
  constructor(private result: PathResult) {}
  async findPath(): Promise<PathResult> {
    return this.result;
  }
}

class FakeFlightPlanner implements IFlightSegmentPlanner {
  constructor(private segment: MoveSegment | null) {}
  async planSegment(): Promise<MoveSegment | null> {
    return this.segment;
  }
}

class FakeBlockInteractionPlanner implements IBlockInteractionPlanner {
  generateActions() {
    return [];
  }
}

describe('PathfindingEngine', () => {
  it('超出最大范围时返回 too_far', async () => {
    const engine = new PathfindingEngine({
      planner: new FakeGroundPlanner({ success: false, reason: 'no_path', nodeCount: 0, durationMs: 0 }),
      flightPlanner: new FakeFlightPlanner(null),
      blockInteractionPlanner: new FakeBlockInteractionPlanner(),
    });

    const from: Vec3 = { x: 0, y: 64, z: 0 };
    const to: Vec3 = { x: 1000, y: 64, z: 0 };
    const result = await engine.findPath(from, to, makeContext());

    expect(result.success).toBe(false);
    expect(result.reason).toBe('too_far');
  });

  it('命中缓存时直接返回路径', async () => {
    const from: Vec3 = { x: 0, y: 64, z: 0 };
    const to: Vec3 = { x: 30, y: 64, z: 0 };
    const path = {
      segments: [{ mode: 'walk' as const, waypoints: [from, to], estimatedCost: 100 }],
      totalCost: 100,
      totalDistance: 30,
      isPartial: false,
    };

    const engine = new PathfindingEngine({
      planner: new FakeGroundPlanner({ success: true, path, nodeCount: 2, durationMs: 0 }),
      flightPlanner: new FakeFlightPlanner(null),
      blockInteractionPlanner: new FakeBlockInteractionPlanner(),
    });

    const first = await engine.findPath(from, to, makeContext());
    expect(first.success).toBe(true);

    const second = await engine.findPath(from, to, makeContext());
    expect(second.success).toBe(true);
    expect(second.durationMs).toBeLessThan(first.durationMs + 10);
  });
});
