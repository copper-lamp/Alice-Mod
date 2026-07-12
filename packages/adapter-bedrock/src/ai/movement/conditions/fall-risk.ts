/**
 * 摔落风险条件
 *
 * 检测前方是否突然出现大落差。
 */

import type { PathContext } from '../../pathfinding/types.js';
import type { IExecutionCondition, ConditionSignal } from '../types.js';
import { FALL_DAMAGE_THRESHOLD } from '../../shared/movement-constants.js';

export class FallRiskCondition implements IExecutionCondition {
  evaluate(ctx: PathContext): ConditionSignal {
    try {
      const pos = ctx.playerPos;
      const yawRad = ((ctx.player.direction?.yaw ?? 0) - 90) * (Math.PI / 180);
      const lookX = Math.cos(yawRad);
      const lookZ = Math.sin(yawRad);

      // 前方 2 格处的脚下
      const fx = Math.floor(pos.x + lookX * 2);
      const fz = Math.floor(pos.z + lookZ * 2);
      const fy = Math.floor(pos.y);

      for (let dy = 0; dy >= -FALL_DAMAGE_THRESHOLD - 2; dy--) {
        // @ts-ignore
        const block = mc.getBlock(fx, fy + dy, fz, 0);
        if (block) {
          const name = String(block.name || block.type || '').toLowerCase();
          if (name !== 'air' && name !== 'cave_air' && name !== 'void_air') {
            return 'continue';
          }
        }
      }

      logger.warn('[ConditionMonitor] 前方检测到摔落风险');
      return 'pause';
    } catch (e) {
      return 'continue';
    }
  }
}
