/**
 * V6 方块操作引擎 — 区域规划器
 *
 * 负责将区域操作拆分为有序的操作队列，支持 fill / clear / break / vein 四种模式。
 */

import type { Vec3 } from '../pathfinding/types.js';
import type { AreaMode } from './types.js';
import { configManager } from '../../config/index.js';
import { normalizeName } from '../inventory/InventoryEngine.js';

/** 6 个邻接方向 */
const DIRECTIONS: Vec3[] = [
  { x: 1, y: 0, z: 0 },
  { x: -1, y: 0, z: 0 },
  { x: 0, y: 1, z: 0 },
  { x: 0, y: -1, z: 0 },
  { x: 0, y: 0, z: 1 },
  { x: 0, y: 0, z: -1 },
];

export class AreaPlanner {
  private world: any;

  constructor(world: any) {
    this.world = world;
  }

  /**
   * 生成有序操作队列
   */
  buildQueue(mode: AreaMode, from: Vec3, to?: Vec3, blockName?: string, radius?: number): Vec3[] {
    switch (mode) {
      case 'fill':
      case 'clear':
      case 'break':
        return this.buildCuboidQueue(from, to);
      case 'vein':
        return this.buildVeinQueue(from, radius);
      default:
        return [];
    }
  }

  /**
   * 检查区域体积是否超过配置上限
   */
  checkVolumeLimit(count: number): { ok: boolean; max: number } {
    const max = configManager.block.max_area_operation_blocks;
    return { ok: count <= max, max };
  }

  /**
   * 生成长方体区域队列：按 Y 轴分层，每层 X-Z 蛇形遍历
   */
  private buildCuboidQueue(from: Vec3, to?: Vec3): Vec3[] {
    const end = to ?? from;
    const minX = Math.min(from.x, end.x);
    const maxX = Math.max(from.x, end.x);
    const minY = Math.min(from.y, end.y);
    const maxY = Math.max(from.y, end.y);
    const minZ = Math.min(from.z, end.z);
    const maxZ = Math.max(from.z, end.z);

    const queue: Vec3[] = [];

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const zStart = (x - minX) % 2 === 0 ? minZ : maxZ;
        const zEnd = (x - minX) % 2 === 0 ? maxZ : minZ;
        const zStep = zStart <= zEnd ? 1 : -1;

        for (let z = zStart; zStart <= zEnd ? z <= zEnd : z >= zEnd; z += zStep) {
          queue.push({ x, y, z });
        }
      }
    }

    return queue;
  }

  /**
   * vein 模式：从起点 BFS 搜索相连同类型方块
   */
  private buildVeinQueue(from: Vec3, radius = 16): Vec3[] {
    const startBlock = this.safeGetBlock(from);
    const targetName = startBlock ? normalizeName(startBlock.name) : null;

    if (!targetName || targetName === 'air') return [];

    const maxBlocks = configManager.block.max_area_operation_blocks;
    const queue: Vec3[] = [];
    const visited = new Set<string>();
    const pending: Array<{ pos: Vec3; dist: number }> = [{ pos: from, dist: 0 }];
    let pendingHead = 0;

    const key = (p: Vec3) => `${p.x},${p.y},${p.z}`;
    visited.add(key(from));

    while (pendingHead < pending.length) {
      const { pos, dist } = pending[pendingHead++];

      if (dist > radius) continue;
      if (queue.length >= maxBlocks) break;

      const block = this.safeGetBlock(pos);
      const name = block ? normalizeName(block.name) : 'air';
      if (name !== targetName) continue;

      queue.push(pos);

      for (const dir of DIRECTIONS) {
        const next: Vec3 = { x: pos.x + dir.x, y: pos.y + dir.y, z: pos.z + dir.z };
        const k = key(next);
        if (visited.has(k)) continue;
        visited.add(k);
        pending.push({ pos: next, dist: dist + 1 });
      }
    }

    return queue;
  }

  /**
   * 安全读取世界方块
   */
  private safeGetBlock(pos: Vec3): any | null {
    try {
      if (this.world && typeof this.world.getBlock === 'function') {
        return this.world.getBlock(pos.x, pos.y, pos.z);
      }
      return mc.getBlock(pos.x, pos.y, pos.z, 0);
    } catch (e) {
      return null;
    }
  }
}
