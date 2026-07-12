/**
 * 摔落保护条件
 *
 * 避免经过可能造成摔落伤害的节点。
 */

import type { IPathCondition, PathContext, Vec3, ConditionEvaluation } from '../types.js';
import { FALL_DAMAGE_THRESHOLD } from '../../shared/movement-constants.js';

export class FallDamageCondition implements IPathCondition {
  evaluate(_ctx: PathContext, point: Vec3): ConditionEvaluation {
    try {
      // 检查当前点下方是否有支撑
      // @ts-ignore
      const below = mc.getBlock(Math.floor(point.x), Math.floor(point.y - 1), Math.floor(point.z), 0);
      if (!below) {
        return { pass: false, costMultiplier: 3.0, reason: '下方无支撑' };
      }

      const name = String(below.name || below.type || '').toLowerCase();
      const airLike = new Set(['air', 'cave_air', 'void_air']);
      if (airLike.has(name)) {
        return { pass: false, costMultiplier: 3.0, reason: '下方为空' };
      }

      // 检查前方是否突然出现大落差（简化判断：连续下降超过阈值）
      // 这里仅对当前点做静态检查，动态连续落差在执行层 ConditionMonitor 处理
      return { pass: true };
    } catch (e) {
      return { pass: true };
    }
  }
}
