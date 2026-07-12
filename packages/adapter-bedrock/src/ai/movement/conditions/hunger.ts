/**
 * 饥饿条件
 */

import type { PathContext } from '../../pathfinding/types.js';
import type { IExecutionCondition, ConditionSignal } from '../types.js';
import { LOW_HUNGER_THRESHOLD } from '../../shared/movement-constants.js';

export class HungerCondition implements IExecutionCondition {
  evaluate(ctx: PathContext): ConditionSignal {
    if (ctx.playerHunger <= LOW_HUNGER_THRESHOLD) {
      return 'pause';
    }
    return 'continue';
  }
}
