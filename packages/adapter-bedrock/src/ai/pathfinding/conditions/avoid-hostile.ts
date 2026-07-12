/**
 * 避开敌对生物条件
 */

import type { IPathCondition, PathContext, Vec3, ConditionEvaluation } from '../types.js';

export class AvoidHostileCondition implements IPathCondition {
  evaluate(ctx: PathContext, point: Vec3): ConditionEvaluation {
    if (!ctx.options.avoidHostile || ctx.hostileEntities.length === 0) {
      return { pass: true };
    }

    const radius = 8; // 路径点与敌对生物的安全距离
    for (const enemy of ctx.hostileEntities) {
      const dx = enemy.pos.x - point.x;
      const dy = enemy.pos.y - point.y;
      const dz = enemy.pos.z - point.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist < radius) {
        return {
          pass: false,
          costMultiplier: Infinity,
          reason: `敌对生物 ${enemy.type} 在 ${dist.toFixed(1)} 格内`,
        };
      }
    }

    return { pass: true };
  }
}
