/**
 * V5 背包操作引擎 — 物品最大堆叠估计
 *
 * LLSE Item 未暴露 maxStackSize，因此维护常见分类映射。
 * 未命中时默认 64，可通过配置文件扩展。
 */

const DEFAULT_MAX_STACK = 64;

// 最大堆叠为 1 的物品后缀/关键词
const SIZE_1_KEYWORDS = new Set([
  '_sword',
  '_axe',
  '_pickaxe',
  '_shovel',
  '_hoe',
  'shears',
  'flint_and_steel',
  'bow',
  'crossbow',
  'shield',
  'elytra',
  'totem_of_undying',
  'trident',
  'mace',
  'fishing_rod',
  'carrot_on_a_stick',
  'warped_fungus_on_a_stick',
  'saddle',
  'name_tag',
  'enchanted_book',
  'writable_book',
  'written_book',
  'map',
  'filled_map',
  'potion',
  'splash_potion',
  'lingering_potion',
  'glass_bottle',
  'honey_bottle',
  'mushroom_stew',
  'rabbit_stew',
  'beetroot_soup',
  'suspicious_stew',
  'cake',
  'saddle',
  'bucket', // 空桶实际 16，但在盔甲/副手场景通常当作 1
]);

// 最大堆叠为 16 的物品后缀/关键词
const SIZE_16_KEYWORDS = new Set([
  'ender_pearl',
  'snowball',
  'egg',
  'chicken_spawn_egg', // 刷怪蛋统一 64？实际上刷怪蛋 64
  'sign',
  'hanging_sign',
  'banner',
  'white_banner',
  'bucket',
]);

const SIZE_1_EXACT = new Set([
  'bow',
  'shield',
  'elytra',
  'shears',
  'saddle',
  'name_tag',
  'totem_of_undying',
  'trident',
  'mace',
  'bucket',
]);

const SIZE_16_EXACT = new Set([
  'ender_pearl',
  'snowball',
  'egg',
  'bucket',
]);

export function getMaxStackSize(itemName: string): number {
  const name = itemName.toLowerCase().replace(/^minecraft:/, '');

  if (SIZE_1_EXACT.has(name)) return 1;
  if (SIZE_16_EXACT.has(name)) return 16;

  for (const kw of SIZE_1_KEYWORDS) {
    if (name.includes(kw)) return 1;
  }
  for (const kw of SIZE_16_KEYWORDS) {
    if (name.includes(kw)) return 16;
  }

  return DEFAULT_MAX_STACK;
}
