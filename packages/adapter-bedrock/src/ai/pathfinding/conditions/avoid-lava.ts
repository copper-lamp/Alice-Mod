/**
 * 避开危险地形条件（岩浆、岩浆块、仙人掌）
 */

import type { IPathCondition, PathContext, Vec3, ConditionEvaluation } from '../types.js';

const DANGER_BLOCKS = new Set([
  'lava',
  'flowing_lava',
  'magma',
  'cactus',
  'fire',
  'soul_fire',
  'sweet_berry_bush',
]);

export class AvoidLavaCondition implements IPathCondition {
  evaluate(_ctx: PathContext, point: Vec3): ConditionEvaluation {
    try {
      const block = mc.getBlock(Math.floor(point.x), Math.floor(point.y), Math.floor(point.z), 0);
      if (!block) return { pass: true };

      const name = String(block.name || block.type || '').toLowerCase();
      if (DANGER_BLOCKS.has(name)) {
        return { pass: false, costMultiplier: Infinity, reason: `危险方块: ${name}` };
      }

      // 脚下也是危险方块
      const below = mc.getBlock(Math.floor(point.x), Math.floor(point.y - 1), Math.floor(point.z), 0);
      if (below) {
        const belowName = String(below.name || below.type || '').toLowerCase();
        if (DANGER_BLOCKS.has(belowName)) {
          return { pass: false, costMultiplier: Infinity, reason: `脚下危险方块: ${belowName}` };
        }
      }

      return { pass: true };
    } catch (e) {
      return { pass: true };
    }
  }
}
