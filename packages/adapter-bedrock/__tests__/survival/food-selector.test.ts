/**
 * FoodSelector 单元测试
 */

import { describe, it, expect } from 'vitest';
import { FoodSelector, isFood, getFoodInfo, scoreFood } from '../../src/ai/survival/FoodSelector.js';
import type { ItemStack } from '../../src/ai/inventory/types.js';

function createItemStack(name: string, count: number, slot: number): ItemStack {
  return { name, count, slot, source: 'inventory' };
}

describe('FoodSelector', () => {
  it('isFood 应正确识别食物与非食物', () => {
    expect(isFood('cooked_beef')).toBe(true);
    expect(isFood('apple')).toBe(true);
    expect(isFood('minecraft:golden_apple')).toBe(true);
    expect(isFood('stone')).toBe(false);
    expect(isFood('diamond_pickaxe')).toBe(false);
  });

  it('getFoodInfo 应返回正确营养值', () => {
    const beef = getFoodInfo('cooked_beef');
    expect(beef).not.toBeNull();
    expect(beef!.hungerRestored).toBe(8);
    expect(beef!.saturationRestored).toBe(12.8);
  });

  it('scoreFood 应按饥饿值*2 + 饱和度*4评分', () => {
    const beef = getFoodInfo('cooked_beef')!;
    expect(scoreFood(beef)).toBe(8 * 2 + 12.8 * 4);

    const apple = getFoodInfo('apple')!;
    expect(scoreFood(apple)).toBe(4 * 2 + 2.4 * 4);
  });

  it('selectBest 应选择饱和度最高的食物', () => {
    const selector = new FoodSelector();
    const inventory: ItemStack[] = [
      createItemStack('apple', 1, 0),
      createItemStack('cooked_beef', 1, 1),
      createItemStack('bread', 1, 2),
    ];

    const best = selector.selectBest(inventory);
    expect(best).not.toBeNull();
    expect(best!.slot.name).toBe('cooked_beef');
  });

  it('selectBest 默认过滤带负面效果的食物', () => {
    const selector = new FoodSelector();
    const inventory: ItemStack[] = [
      createItemStack('rotten_flesh', 1, 0),
      createItemStack('bread', 1, 1),
    ];

    const best = selector.selectBest(inventory);
    expect(best).not.toBeNull();
    expect(best!.slot.name).toBe('bread');
  });

  it('selectBest 允许带负面效果食物时选择评分最高的', () => {
    const selector = new FoodSelector();
    const inventory: ItemStack[] = [
      createItemStack('rotten_flesh', 1, 0),
      createItemStack('bread', 1, 1),
    ];

    const best = selector.selectBest(inventory, true);
    expect(best).not.toBeNull();
    // rotten_flesh 评分为 4*2 + 0.8*4 = 11.2，bread 为 5*2 + 6*4 = 34，应选择 bread
    expect(best!.slot.name).toBe('bread');
  });

  it('selectBest 在空背包时返回 null', () => {
    const selector = new FoodSelector();
    expect(selector.selectBest([])).toBeNull();
  });
});
