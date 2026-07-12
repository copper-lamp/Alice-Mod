/**
 * 遇敌检测条件
 */

import type { PathContext } from '../../pathfinding/types.js';
import type { IExecutionCondition, ConditionSignal } from '../types.js';
import { ENEMY_REACTION_RADIUS } from '../../shared/movement-constants.js';

export class EnemyDetectedCondition implements IExecutionCondition {
  evaluate(ctx: PathContext): ConditionSignal {
    if (!ctx.options.avoidHostile || ctx.hostileEntities.length === 0) {
      return 'continue';
    }

    for (const enemy of ctx.hostileEntities) {
      const dx = enemy.pos.x - ctx.playerPos.x;
      const dy = enemy.pos.y - ctx.playerPos.y;
      const dz = enemy.pos.z - ctx.playerPos.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist < ENEMY_REACTION_RADIUS) {
        logger.warn(`[ConditionMonitor] 检测到敌对生物 ${enemy.type} 在 ${dist.toFixed(1)} 格内`);
        return 'pause';
      }
    }

    return 'continue';
  }
}
