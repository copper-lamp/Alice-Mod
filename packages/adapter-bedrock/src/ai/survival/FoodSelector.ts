/**
 * 食物选择器
 *
 * 内置常见食物营养值表，支持按饥饿值 + 饱和度综合评分自动选择最优食物。
 */

import type { ItemStack } from '../inventory/types.js';
import type { FoodInfo } from './types.js';

const FOOD_TABLE: Record<string, FoodInfo> = {
  apple: { name: 'apple', hungerRestored: 4, saturationRestored: 2.4, hasNegativeEffect: false },
  baked_potato: { name: 'baked_potato', hungerRestored: 5, saturationRestored: 6, hasNegativeEffect: false },
  beetroot: { name: 'beetroot', hungerRestored: 1, saturationRestored: 1.2, hasNegativeEffect: false },
  beetroot_soup: { name: 'beetroot_soup', hungerRestored: 6, saturationRestored: 7.2, hasNegativeEffect: false },
  bread: { name: 'bread', hungerRestored: 5, saturationRestored: 6, hasNegativeEffect: false },
  carrot: { name: 'carrot', hungerRestored: 3, saturationRestored: 3.6, hasNegativeEffect: false },
  chorus_fruit: { name: 'chorus_fruit', hungerRestored: 4, saturationRestored: 2.4, hasNegativeEffect: false },
  cooked_beef: { name: 'cooked_beef', hungerRestored: 8, saturationRestored: 12.8, hasNegativeEffect: false },
  cooked_chicken: { name: 'cooked_chicken', hungerRestored: 6, saturationRestored: 7.2, hasNegativeEffect: false },
  cooked_cod: { name: 'cooked_cod', hungerRestored: 5, saturationRestored: 6, hasNegativeEffect: false },
  cooked_mutton: { name: 'cooked_mutton', hungerRestored: 6, saturationRestored: 9.6, hasNegativeEffect: false },
  cooked_porkchop: { name: 'cooked_porkchop', hungerRestored: 8, saturationRestored: 12.8, hasNegativeEffect: false },
  cooked_rabbit: { name: 'cooked_rabbit', hungerRestored: 5, saturationRestored: 6, hasNegativeEffect: false },
  cooked_salmon: { name: 'cooked_salmon', hungerRestored: 6, saturationRestored: 9.6, hasNegativeEffect: false },
  cookie: { name: 'cookie', hungerRestored: 2, saturationRestored: 0.4, hasNegativeEffect: false },
  dried_kelp: { name: 'dried_kelp', hungerRestored: 1, saturationRestored: 0.6, hasNegativeEffect: false },
  enchanted_golden_apple: { name: 'enchanted_golden_apple', hungerRestored: 4, saturationRestored: 9.6, hasNegativeEffect: false },
  golden_apple: { name: 'golden_apple', hungerRestored: 4, saturationRestored: 9.6, hasNegativeEffect: false },
  golden_carrot: { name: 'golden_carrot', hungerRestored: 6, saturationRestored: 14.4, hasNegativeEffect: false },
  honey_bottle: { name: 'honey_bottle', hungerRestored: 6, saturationRestored: 1.2, hasNegativeEffect: false },
  melon_slice: { name: 'melon_slice', hungerRestored: 2, saturationRestored: 1.2, hasNegativeEffect: false },
  mushroom_stew: { name: 'mushroom_stew', hungerRestored: 6, saturationRestored: 7.2, hasNegativeEffect: false },
  poisonous_potato: { name: 'poisonous_potato', hungerRestored: 2, saturationRestored: 1.2, hasNegativeEffect: true },
  potato: { name: 'potato', hungerRestored: 1, saturationRestored: 0.6, hasNegativeEffect: false },
  pufferfish: { name: 'pufferfish', hungerRestored: 1, saturationRestored: 0.2, hasNegativeEffect: true },
  pumpkin_pie: { name: 'pumpkin_pie', hungerRestored: 8, saturationRestored: 4.8, hasNegativeEffect: false },
  rabbit_stew: { name: 'rabbit_stew', hungerRestored: 10, saturationRestored: 12, hasNegativeEffect: false },
  raw_beef: { name: 'raw_beef', hungerRestored: 3, saturationRestored: 1.8, hasNegativeEffect: false },
  raw_chicken: { name: 'raw_chicken', hungerRestored: 2, saturationRestored: 1.2, hasNegativeEffect: true },
  raw_cod: { name: 'raw_cod', hungerRestored: 2, saturationRestored: 0.4, hasNegativeEffect: false },
  raw_mutton: { name: 'raw_mutton', hungerRestored: 2, saturationRestored: 1.2, hasNegativeEffect: false },
  raw_porkchop: { name: 'raw_porkchop', hungerRestored: 3, saturationRestored: 1.8, hasNegativeEffect: false },
  raw_rabbit: { name: 'raw_rabbit', hungerRestored: 3, saturationRestored: 1.8, hasNegativeEffect: false },
  raw_salmon: { name: 'raw_salmon', hungerRestored: 2, saturationRestored: 0.4, hasNegativeEffect: false },
  rotten_flesh: { name: 'rotten_flesh', hungerRestored: 4, saturationRestored: 0.8, hasNegativeEffect: true },
  spider_eye: { name: 'spider_eye', hungerRestored: 2, saturationRestored: 3.2, hasNegativeEffect: true },
  steak: { name: 'steak', hungerRestored: 8, saturationRestored: 12.8, hasNegativeEffect: false },
  sweet_berries: { name: 'sweet_berries', hungerRestored: 2, saturationRestored: 0.4, hasNegativeEffect: false },
  tropical_fish: { name: 'tropical_fish', hungerRestored: 1, saturationRestored: 0.2, hasNegativeEffect: false },
};

export function isFood(name: string): boolean {
  return getFoodInfo(name) !== null;
}

export function getFoodInfo(name: string): FoodInfo | null {
  const key = normalizeFoodName(name);
  return FOOD_TABLE[key] ?? null;
}

export function scoreFood(food: FoodInfo): number {
  return food.hungerRestored * 2 + food.saturationRestored * 4;
}

export class FoodSelector {
  /**
   * 判断物品是否为食物
   */
  isFood(name: string): boolean {
    return isFood(name);
  }

  /**
   * 获取食物信息
   */
  getFoodInfo(name: string): FoodInfo | null {
    return getFoodInfo(name);
  }

  /**
   * 计算食物评分：饥饿恢复权重 2，饱和度恢复权重 4
   */
  scoreFood(food: FoodInfo): number {
    return scoreFood(food);
  }

  /**
   * 从背包中选择评分最高且不会带来负面效果的食物
   */
  selectBest(
    inventory: ItemStack[],
    allowNegativeEffect = false,
  ): { slot: ItemStack; food: FoodInfo } | null {
    let best: { slot: ItemStack; food: FoodInfo } | null = null;
    let bestScore = -Infinity;

    for (const slot of inventory) {
      const food = this.getFoodInfo(slot.name);
      if (!food) continue;
      if (food.hasNegativeEffect && !allowNegativeEffect) continue;

      const score = this.scoreFood(food);
      if (score > bestScore) {
        bestScore = score;
        best = { slot, food };
      }
    }

    return best;
  }
}

function normalizeFoodName(name: string): string {
  return name
    .toLowerCase()
    .replace(/^minecraft:/, '')
    .replace(/\s+/g, '_')
    .trim();
}
