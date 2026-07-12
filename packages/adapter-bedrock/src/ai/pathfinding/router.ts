/**
 * 移动模式路由器
 *
 * 根据距离、地形、玩家状态、配置选择移动模式。
 */

import type { Vec3, PathContext, MoveMode } from './types.js';
import { ELYTRA_MIN_DISTANCE, FALL_DAMAGE_THRESHOLD } from '../shared/movement-constants.js';

export class MovementRouter {
  /**
   * 为整个路径选择主导移动模式
   */
  selectMode(from: Vec3, to: Vec3, ctx: PathContext): MoveMode {
    const distance = this.distance(from, to);
    const runtime = ctx.options;

    // 短距离：走路或疾跑
    if (distance < 8) {
      return this.canSprint(ctx) ? 'walk' : 'walk'; // 近距离用 walk 更稳
    }

    // 鞘翅场景触发（需要配置开启且距离足够）
    if (
      runtime.allowElytra &&
      distance >= ELYTRA_MIN_DISTANCE &&
      this.hasElytraAndFirework(ctx)
    ) {
      const verticalDiff = Math.abs(to.y - from.y);
      const horizontal = Math.sqrt((to.x - from.x) ** 2 + (to.z - from.z) ** 2);
      // 主要是水平跨度才触发鞘翅
      if (horizontal > distance * 0.8 && verticalDiff < distance * 0.3) {
        return 'elytra';
      }
    }

    // 默认：疾跑（如果允许）
    return this.canSprint(ctx) ? 'sprint' : 'walk';
  }

  /**
   * 根据当前段的地形特征选择段模式
   */
  selectSegmentMode(prev: Vec3, current: Vec3, next: Vec3, ctx: PathContext): MoveMode {
    const runtime = ctx.options;

    // 垂直攀爬
    if (this.isClimbable(current, ctx)) {
      return 'climb';
    }

    // 水域
    if (this.isWater(current, ctx)) {
      return runtime.allowSwim ? 'swim' : 'walk';
    }

    // 需要跳跃（2 格高差）
    if (next && Math.abs(next.y - current.y) > 1.2) {
      return this.canSprint(ctx) ? 'sprint_jump' : 'walk';
    }

    // 默认疾跑/走路
    return this.canSprint(ctx) ? 'sprint' : 'walk';
  }

  /**
   * 判断是否可疾跑
   */
  canSprint(ctx: PathContext): boolean {
    const runtime = ctx.options;
    return (
      runtime.allowSprint &&
      ctx.playerHunger >= 7
    );
  }

  /**
   * 判断是否有鞘翅和烟花
   */
  private hasElytraAndFirework(ctx: PathContext): boolean {
    const hasElytra = ctx.inventory.some((i) => i.name === 'elytra');
    const hasFirework = ctx.inventory.some((i) => i.name === 'firework_rocket');
    return hasElytra && hasFirework;
  }

  /**
   * 判断某点是否攀爬物
   */
  private isClimbable(pos: Vec3, _ctx: PathContext): boolean {
    try {
      const block = mc.getBlock(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z), 0);
      if (!block) return false;
      const name = String(block.name || block.type || '');
      return name.includes('ladder') || name.includes('vine') || name.includes('scaffolding');
    } catch (e) {
      return false;
    }
  }

  /**
   * 判断某点是否水域
   */
  private isWater(pos: Vec3, _ctx: PathContext): boolean {
    try {
      const block = mc.getBlock(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z), 0);
      if (!block) return false;
      const name = String(block.name || block.type || '');
      return name.includes('water') && !name.includes('waterfall');
    } catch (e) {
      return false;
    }
  }

  private distance(a: Vec3, b: Vec3): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dz = a.z - b.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
}

export const movementRouter = new MovementRouter();
