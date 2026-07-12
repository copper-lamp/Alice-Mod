/**
 * 条件监控器
 *
 * 每 tick 评估执行层条件，返回控制信号。
 */

import type { PathContext } from '../pathfinding/types.js';
import type { IConditionMonitor, ConditionSignal } from './types.js';
import {
  EnemyDetectedCondition,
  LowHealthCondition,
  FallRiskCondition,
  HungerCondition,
} from './conditions/index.js';

export class ConditionMonitor implements IConditionMonitor {
  private conditions: Array<import('./types.js').IExecutionCondition> = [
    new LowHealthCondition(),
    new HungerCondition(),
    new EnemyDetectedCondition(),
    new FallRiskCondition(),
  ];

  tick(ctx: PathContext): ConditionSignal {
    for (const condition of this.conditions) {
      const signal = condition.evaluate(ctx);
      if (signal !== 'continue') {
        return signal;
      }
    }
    return 'continue';
  }
}
