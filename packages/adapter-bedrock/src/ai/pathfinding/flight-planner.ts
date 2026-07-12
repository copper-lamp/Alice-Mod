/**
 * 鞘翅场景段规划器
 *
 * 第一版仅做场景触发：当目标距离远、水平跨度大、且玩家拥有鞘翅和烟花时，
 * 生成一段从起飞点到降落点的直线滑翔路径。
 */

import type { Vec3, PathContext, MoveSegment, IFlightSegmentPlanner } from './types.js';
import { ELYTRA_MIN_DISTANCE } from '../shared/movement-constants.js';

export class FlightSegmentPlanner implements IFlightSegmentPlanner {
  async planSegment(from: Vec3, to: Vec3, ctx: PathContext): Promise<MoveSegment | null> {
    const options = ctx.options;

    if (!options.allowElytra) return null;

    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const horizontal = Math.sqrt(dx * dx + dz * dz);

    if (distance < ELYTRA_MIN_DISTANCE || horizontal < distance * 0.7) {
      return null;
    }

    // 检查是否有鞘翅和烟花
    const hasElytra = ctx.inventory.some((i) => i.name === 'elytra');
    const hasFirework = ctx.inventory.some((i) => i.name === 'firework_rocket');
    if (!hasElytra || !hasFirework) {
      return null;
    }

    // 起飞点：从当前位置向前上方起飞
    const takeoffPoint = this.findTakeoffPoint(from, to);
    // 降落点：目标点正下方最近的安全地面
    const landingPoint = this.findLandingPoint(to, ctx);

    if (!takeoffPoint || !landingPoint) return null;

    return {
      mode: 'elytra',
      waypoints: [takeoffPoint, landingPoint],
      estimatedCost: (distance / 12) * 1000, // 12 m/s 近似滑翔速度
      requiredItems: ['elytra', 'firework_rocket'],
    };
  }

  /**
   * 寻找起飞点：当前位置向上抬高 5 格，确保有足够起飞高度
   */
  private findTakeoffPoint(from: Vec3, to: Vec3): Vec3 | null {
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const horizontal = Math.sqrt(dx * dx + dz * dz);
    if (horizontal === 0) return null;

    const dirX = dx / horizontal;
    const dirZ = dz / horizontal;

    return {
      x: from.x + dirX * 2,
      y: from.y + 5,
      z: from.z + dirZ * 2,
    };
  }

  /**
   * 寻找安全降落点：目标位置下方找到第一个非空方块
   */
  private findLandingPoint(to: Vec3, ctx: PathContext): Vec3 | null {
    const dimid = ctx.playerDimid;
    for (let dy = 0; dy >= -10; dy--) {
      const y = Math.floor(to.y + dy);
      try {
        const block = mc.getBlock(Math.floor(to.x), y, Math.floor(to.z), dimid);
        if (!block) continue;
        const name = String(block.name || block.type || '').toLowerCase();
        if (name !== 'air' && name !== 'cave_air' && name !== 'void_air') {
          return { x: to.x, y: y + 1, z: to.z };
        }
      } catch (e) {
        continue;
      }
    }
    return null;
  }
}

export const flightSegmentPlanner = new FlightSegmentPlanner();
