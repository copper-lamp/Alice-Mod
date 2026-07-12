import { describe, it, expect } from 'vitest';
import { InventoryRequirementChecker } from '../../src/ai/movement/inventory-requirement-checker.js';
import type { BlockActionPlan, ItemSnapshot } from '../../src/ai/pathfinding/types.js';

describe('InventoryRequirementChecker', () => {
  const checker = new InventoryRequirementChecker();

  it('材料充足时通过', () => {
    const actions: BlockActionPlan[] = [
      { type: 'place', targetPos: { x: 0, y: 0, z: 0 }, blockName: 'dirt', estimatedTimeMs: 200 },
      { type: 'place', targetPos: { x: 1, y: 0, z: 0 }, blockName: 'dirt', estimatedTimeMs: 200 },
    ];
    const inventory: ItemSnapshot[] = [{ name: 'dirt', count: 5, slot: 0 }];

    expect(checker.verify(actions, inventory)).toEqual({ ok: true });
  });

  it('材料不足时返回缺失项', () => {
    const actions: BlockActionPlan[] = [
      { type: 'place', targetPos: { x: 0, y: 0, z: 0 }, blockName: 'cobblestone', estimatedTimeMs: 200 },
    ];
    const inventory: ItemSnapshot[] = [{ name: 'cobblestone', count: 0, slot: 0 }];

    const result = checker.verify(actions, inventory);
    expect(result.ok).toBe(false);
    expect(result.missing).toContain('cobblestone(0/1)');
  });

  it('缺少工具时返回缺失工具', () => {
    const actions: BlockActionPlan[] = [
      { type: 'break', targetPos: { x: 0, y: 0, z: 0 }, toolName: 'iron_pickaxe', estimatedTimeMs: 500 },
    ];
    const inventory: ItemSnapshot[] = [];

    const result = checker.verify(actions, inventory);
    expect(result.ok).toBe(false);
    expect(result.missing).toContain('tool:iron_pickaxe');
  });
});
