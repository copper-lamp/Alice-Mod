/**
 * ToolSelector 单元测试
 */

import { describe, it, expect } from 'vitest';
import { ToolSelector } from '../../src/ai/block/ToolSelector.js';
import type { ItemStack } from '../../src/ai/inventory/types.js';

function createItemStack(name: string, count: number, slot: number): ItemStack {
  return { name, count, slot, source: 'inventory' };
}

describe('ToolSelector', () => {
  const selector = new ToolSelector();

  it('isUnbreakable 应识别基岩等不可破坏方块', () => {
    expect(selector.isUnbreakable('bedrock')).toBe(true);
    expect(selector.isUnbreakable('command_block')).toBe(true);
    expect(selector.isUnbreakable('barrier')).toBe(true);
    expect(selector.isUnbreakable('stone')).toBe(false);
  });

  it('selectToolForBlock 石头类应选择镐', () => {
    const inventory = [
      createItemStack('iron_pickaxe', 1, 0),
      createItemStack('iron_axe', 1, 1),
      createItemStack('iron_shovel', 1, 2),
    ];
    const rec = selector.selectToolForBlock('stone', inventory);
    expect(rec.toolSlot).toBe(0);
    expect(rec.canHandMine).toBe(false);
  });

  it('selectToolForBlock 泥土类应选择锹', () => {
    const inventory = [
      createItemStack('iron_pickaxe', 1, 0),
      createItemStack('iron_axe', 1, 1),
      createItemStack('iron_shovel', 1, 2),
    ];
    const rec = selector.selectToolForBlock('dirt', inventory);
    expect(rec.toolSlot).toBe(2);
    expect(rec.canHandMine).toBe(true);
  });

  it('selectToolForBlock 木头类应选择斧', () => {
    const inventory = [
      createItemStack('iron_pickaxe', 1, 0),
      createItemStack('iron_axe', 1, 1),
    ];
    const rec = selector.selectToolForBlock('oak_log', inventory);
    expect(rec.toolSlot).toBe(1);
  });

  it('selectToolForBlock 无合适工具时允许手挖', () => {
    const inventory = [createItemStack('stick', 1, 0)];
    const rec = selector.selectToolForBlock('dirt', inventory);
    expect(rec.toolSlot).toBeNull();
    expect(rec.canHandMine).toBe(true);
  });

  it('selectToolForBlock 石头无工具时不可手挖', () => {
    const inventory = [createItemStack('stick', 1, 0)];
    const rec = selector.selectToolForBlock('stone', inventory);
    expect(rec.toolSlot).toBeNull();
    expect(rec.canHandMine).toBe(false);
  });

  it('selectToolForBlock 应选择更高等级工具', () => {
    const inventory = [
      createItemStack('wooden_pickaxe', 1, 0),
      createItemStack('iron_pickaxe', 1, 1),
      createItemStack('stone_pickaxe', 1, 2),
    ];
    const rec = selector.selectToolForBlock('stone', inventory);
    expect(rec.toolSlot).toBe(1);
  });

  it('findAlternativeTool 应排除指定槽位', () => {
    const inventory = [
      createItemStack('iron_pickaxe', 1, 0),
      createItemStack('diamond_pickaxe', 1, 1),
    ];
    const alt = selector.findAlternativeTool('stone', inventory, 1);
    expect(alt).not.toBeNull();
    expect(alt!.slot).toBe(0);
  });

  it('selectAlternativeBlock 应找到同功能替代材料', () => {
    const inventory = [createItemStack('birch_planks', 16, 0)];
    const alt = selector.selectAlternativeBlock('oak_planks', inventory);
    expect(alt).toBe('birch_planks');
  });

  it('selectAlternativeBlock 无替代时应返回 null', () => {
    const inventory = [createItemStack('dirt', 16, 0)];
    const alt = selector.selectAlternativeBlock('oak_planks', inventory);
    expect(alt).toBeNull();
  });
});
