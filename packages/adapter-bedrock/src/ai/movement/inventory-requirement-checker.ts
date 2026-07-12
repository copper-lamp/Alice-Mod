/**
 * 库存需求检查器
 */

import type { BlockActionPlan, ItemSnapshot } from '../pathfinding/types.js';

export class InventoryRequirementChecker {
  /**
   * 验证背包是否有足够材料与工具执行所有动作
   */
  verify(actions: BlockActionPlan[], inventory: ItemSnapshot[]): { ok: boolean; missing?: string[] } {
    const required = new Map<string, number>();
    const tools = new Set<string>();

    for (const action of actions) {
      if (action.type === 'place') {
        const name = action.blockName ?? 'unknown_block';
        required.set(name, (required.get(name) || 0) + 1);
      } else if (action.type === 'break') {
        if (action.toolName) {
          tools.add(action.toolName);
        }
      }
    }

    const missing: string[] = [];

    for (const [name, count] of required) {
      const have = inventory.filter((i) => i.name === name).reduce((sum, i) => sum + i.count, 0);
      if (have < count) {
        missing.push(`${name}(${have}/${count})`);
      }
    }

    for (const tool of tools) {
      const have = inventory.some((i) => i.name === tool);
      if (!have) {
        missing.push(`tool:${tool}`);
      }
    }

    if (missing.length > 0) {
      return { ok: false, missing };
    }

    return { ok: true };
  }
}

export const inventoryRequirementChecker = new InventoryRequirementChecker();
