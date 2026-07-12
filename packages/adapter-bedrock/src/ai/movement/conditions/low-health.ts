/**
 * 低血量条件
 */

import type { PathContext } from '../../pathfinding/types.js';
import type { IExecutionCondition, ConditionSignal } from '../types.js';
import { LOW_HEALTH_THRESHOLD } from '../../shared/movement-constants.js';

export class LowHealthCondition implements IExecutionCondition {
  evaluate(ctx: PathContext): ConditionSignal {
    if (ctx.playerHealth <= LOW_HEALTH_THRESHOLD) {
      logger.warn(`[ConditionMonitor] 血量过低 ${ctx.playerHealth}，停止移动`);
      return 'stop';
    }
    return 'continue';
  }
}
