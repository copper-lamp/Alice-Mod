/**
 * 饥饿感知条件
 *
 * 饥饿低时增加疾跑代价，优先走路。
 */

import type { IPathCondition, PathContext, Vec3, ConditionEvaluation } from '../types.js';
import { LOW_HUNGER_THRESHOLD } from '../../shared/movement-constants.js';

export class HungerAwareCondition implements IPathCondition {
  evaluate(ctx: PathContext, _point: Vec3): ConditionEvaluation {
    if (ctx.playerHunger > LOW_HUNGER_THRESHOLD) {
      return { pass: true };
    }

    return {
      pass: true,
      costMultiplier: 2.0,
      reason: `饥饿较低 (${ctx.playerHunger})，提高移动代价`,
    };
  }
}
