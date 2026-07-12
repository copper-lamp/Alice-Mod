/**
 * 方块交互规划器
 *
 * 死路时生成挖/搭方块方案（简化版）。
 * - 挖掘：直线路径上前方被阻挡时，挖掉头前 1~2 格方块。
 * - 搭桥：路径跨越 1 格宽沟壑时，在脚下放置方块。
 * - 攀登：遇到 1 格高差时，在脚下放置方块垫高。
 */

import type {
  Vec3,
  BlockActionPlan,
  BlockInteractionOptions,
  WorldAccess,
  IBlockInteractionPlanner,
} from './types.js';

export class BlockInteractionPlanner implements IBlockInteractionPlanner {
  generateActions(from: Vec3, to: Vec3, _world: WorldAccess, options: BlockInteractionOptions, dimid: number = 0): BlockActionPlan[] {
    const actions: BlockActionPlan[] = [];

    if (!options.allowBreak && !options.allowPlace) {
      return actions;
    }

    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const horizontal = Math.sqrt(dx * dx + dz * dz);

    // 1. 搭桥：水平方向有跨度，且 y 差不大
    if (options.allowPlace && horizontal > 1 && Math.abs(dy) <= 1) {
      const steps = Math.min(options.maxBlocksToPlace, Math.ceil(horizontal));
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const px = from.x + dx * t;
        const pz = from.z + dz * t;
        const py = from.y - 1; // 脚下

        if (!this.isSolidBlock(px, py, pz, dimid)) {
          actions.push({
            type: 'place',
            targetPos: { x: Math.floor(px), y: Math.floor(py), z: Math.floor(pz) },
            blockName: options.preferredBlock ?? 'dirt',
            face: { x: 0, y: -1, z: 0 },
            estimatedTimeMs: 200,
          });
        }
      }
    }

    // 2. 攀登：y 差为 1 时，在目标位置脚下放置方块
    if (options.allowPlace && dy > 0 && dy <= 1) {
      actions.push({
        type: 'place',
        targetPos: { x: Math.floor(to.x), y: Math.floor(to.y - 1), z: Math.floor(to.z) },
        blockName: options.preferredBlock ?? 'dirt',
        face: { x: 0, y: -1, z: 0 },
        estimatedTimeMs: 200,
      });
    }

    // 3. 挖掘：前方被阻挡
    if (options.allowBreak) {
      const dirX = horizontal > 0 ? dx / horizontal : 0;
      const dirZ = horizontal > 0 ? dz / horizontal : 0;

      for (let i = 1; i <= Math.min(options.maxBlocksToBreak, 2); i++) {
        const px = from.x + dirX * i;
        const py = from.y;
        const pz = from.z + dirZ * i;

        const blockName = this.getBlockName(px, py, pz, dimid);
        if (blockName && !this.isProtected(blockName, options) && !this.isUnbreakable(blockName, options)) {
          actions.push({
            type: 'break',
            targetPos: { x: Math.floor(px), y: Math.floor(py), z: Math.floor(pz) },
            blockName,
            estimatedTimeMs: 500,
          });
        }

        // 头部高度也可能被挡
        const headY = from.y + 1;
        const headBlock = this.getBlockName(px, headY, pz, dimid);
        if (headBlock && !this.isProtected(headBlock, options) && !this.isUnbreakable(headBlock, options)) {
          actions.push({
            type: 'break',
            targetPos: { x: Math.floor(px), y: Math.floor(headY), z: Math.floor(pz) },
            blockName: headBlock,
            estimatedTimeMs: 500,
          });
        }
      }
    }

    return actions;
  }

  private isSolidBlock(x: number, y: number, z: number, dimid: number): boolean {
    try {
      const block = mc.getBlock(Math.floor(x), Math.floor(y), Math.floor(z), dimid);
      if (!block) return false;
      const name = String(block.name || block.type || '').toLowerCase();
      return name !== 'air' && name !== 'cave_air' && name !== 'void_air' && !name.includes('water') && !name.includes('lava');
    } catch (e) {
      return false;
    }
  }

  private getBlockName(x: number, y: number, z: number, dimid: number): string | null {
    try {
      const block = mc.getBlock(Math.floor(x), Math.floor(y), Math.floor(z), dimid);
      if (!block) return null;
      return String(block.name || block.type || '').toLowerCase();
    } catch (e) {
      return null;
    }
  }

  private isProtected(name: string, options: BlockInteractionOptions): boolean {
    return options.protectedBlocks.has(name);
  }

  private isUnbreakable(name: string, options: BlockInteractionOptions): boolean {
    return options.unbreakableBlocks.has(name);
  }
}

export const blockInteractionPlanner = new BlockInteractionPlanner();
