/**
 * V6 方块操作引擎 — 方块验证器
 *
 * 负责放置面选择、挖掘/放置后的世界状态校验、以及可达性判断。
 */

import type { Vec3 } from '../pathfinding/types.js';
import type { PlacementFace } from './types.js';
import { normalizeName } from '../inventory/InventoryEngine.js';

/**
 * 获取方块内部类型标识（优先 type，避免 name 被本地化）
 */
function getBlockType(block: any): string {
  return normalizeName(block?.type || block?.name || 'air');
}

/** 6 个邻接方向 */
const DIRECTIONS: Vec3[] = [
  { x: 1, y: 0, z: 0 },
  { x: -1, y: 0, z: 0 },
  { x: 0, y: 1, z: 0 },
  { x: 0, y: -1, z: 0 },
  { x: 0, y: 0, z: 1 },
  { x: 0, y: 0, z: -1 },
];

/** 可替换/可忽略方块（放置时不视为阻挡） */
const REPLACEABLE_BLOCKS = new Set([
  'air',
  'cave_air',
  'void_air',
  'water',
  'lava',
  'grass',
  'tall_grass',
  'fern',
  'large_fern',
  'dead_bush',
  'seagrass',
  'tall_seagrass',
  'kelp',
  'snow',
]);

export class BlockValidator {
  /**
   * 为目标坐标寻找合法的放置邻接面
   */
  findPlacementFace(pos: Vec3, world: any, playerPos: Vec3): PlacementFace | null {
    let best: PlacementFace | null = null;
    let bestScore = -Infinity;

    for (const dir of DIRECTIONS) {
      const neighbor: Vec3 = { x: pos.x + dir.x, y: pos.y + dir.y, z: pos.z + dir.z };
      const neighborBlock = this.safeGetBlock(world, neighbor);
      const neighborName = getBlockType(neighborBlock);

      // 邻接方块必须是实体方块，不能是空气或可替换方块
      if (REPLACEABLE_BLOCKS.has(neighborName)) continue;

      // 目标位置本身必须可放置（空气或可替换）
      const targetBlock = this.safeGetBlock(world, pos);
      const targetName = getBlockType(targetBlock);
      if (!REPLACEABLE_BLOCKS.has(targetName)) continue;

      // 玩家需要能够到达该放置面附近
      const faceCenter: Vec3 = {
        x: neighbor.x + 0.5 - dir.x * 0.5,
        y: neighbor.y + 0.5 - dir.y * 0.5,
        z: neighbor.z + 0.5 - dir.z * 0.5,
      };
      const dist = this.distance(playerPos, faceCenter);
      const reachScore = 100 - dist * 10;

      // 优先选择朝向玩家的面
      const dot = (playerPos.x - faceCenter.x) * dir.x + (playerPos.y - faceCenter.y) * dir.y + (playerPos.z - faceCenter.z) * dir.z;
      const facingScore = dot > 0 ? 20 : 0;

      const score = reachScore + facingScore;
      if (score > bestScore) {
        bestScore = score;
        best = { face: dir, neighbor };
      }
    }

    return best;
  }

  /**
   * 操作后校验方块是否变为 air
   */
  confirmBroken(pos: Vec3, world: any): boolean {
    const block = this.safeGetBlock(world, pos);
    const name = getBlockType(block);
    return name === 'air' || REPLACEABLE_BLOCKS.has(name);
  }

  /**
   * 操作后校验目标坐标方块是否为预期类型
   */
  confirmPlaced(pos: Vec3, world: any, expectedName: string): boolean {
    const block = this.safeGetBlock(world, pos);
    if (!block) return false;
    const actual = getBlockType(block);
    const expected = normalizeName(expectedName);
    return actual === expected || this.isEquivalentBlock(actual, expected);
  }

  /**
   * 判断玩家是否在操作范围内
   */
  isReachable(pos: Vec3, playerPos: Vec3, maxDistance: number): boolean {
    const dx = pos.x + 0.5 - playerPos.x;
    const dy = pos.y + 0.5 - playerPos.y;
    const dz = pos.z + 0.5 - playerPos.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz) <= maxDistance;
  }

  /**
   * 安全读取世界方块
   */
  private safeGetBlock(world: any, pos: Vec3): any | null {
    try {
      if (world && typeof world.getBlock === 'function') {
        return world.getBlock(pos.x, pos.y, pos.z);
      }
      return mc.getBlock(pos.x, pos.y, pos.z, 0);
    } catch (e) {
      return null;
    }
  }

  /**
   * 计算两点距离
   */
  private distance(a: Vec3, b: Vec3): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dz = a.z - b.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  /**
   * 判断两个方块名称是否等价（考虑 minecraft: 前缀与常见别名）
   */
  private isEquivalentBlock(actual: string, expected: string): boolean {
    if (actual === expected) return true;
    // 例如 grass 与 grass_block 不做等价处理，严格匹配
    return false;
  }
}
