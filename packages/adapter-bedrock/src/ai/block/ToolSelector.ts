/**
 * V6 方块操作引擎 — 工具选择器
 *
 * 负责根据方块类型选择最优挖掘工具，并在工具耐久不足或材料不足时
 * 寻找背包内的可用替代方案。
 */

import type { ItemStack } from '../inventory/types.js';
import type { ToolRecommendation } from './types.js';
import { normalizeName } from '../inventory/InventoryEngine.js';

/** 不可破坏方块集合 */
const UNBREAKABLE_BLOCKS = new Set([
  'bedrock',
  'barrier',
  'command_block',
  'chain_command_block',
  'repeating_command_block',
  'structure_block',
  'jigsaw',
  'end_portal_frame',
  'end_portal',
  'nether_portal',
  'water',
  'lava',
]);

/** 工具类型优先级映射 */
const TOOL_PRIORITY: Record<string, number> = {
  netherite: 5,
  diamond: 4,
  iron: 3,
  stone: 2,
  wooden: 1,
  wood: 1,
  gold: 1,
  golden: 1,
};

/** 方块→工具类型映射规则 */
const BLOCK_TOOL_RULES: Array<{
  match: (name: string) => boolean;
  toolType: string;
  canHandMine: boolean;
}> = [
  // 石头类：必须用镐
  { match: (n) => /stone|cobblestone|granite|diorite|andesite|deepslate|tuff|calcite|dripstone|basalt|blackstone|netherrack|end_stone|sandstone|red_sandstone|concrete$/.test(n), toolType: 'pickaxe', canHandMine: false },
  // 矿石类
  { match: (n) => /_ore$|raw_/.test(n), toolType: 'pickaxe', canHandMine: false },
  // 泥土类
  { match: (n) => /dirt|grass_block|mycelium|podzol|farmland|clay|gravel|sand|red_sand|soul_sand|soul_soil/.test(n), toolType: 'shovel', canHandMine: true },
  // 雪/冰
  { match: (n) => /snow|ice|powder_snow/.test(n), toolType: 'shovel', canHandMine: true },
  // 木头类
  { match: (n) => /log|wood|planks|fence$|fence_gate|door$|trapdoor$|stripped_/.test(n), toolType: 'axe', canHandMine: true },
  // 树叶与羊毛
  { match: (n) => /leaves|wool$/.test(n), toolType: 'shears', canHandMine: true },
  // 作物与植物
  { match: (n) => /wheat|carrots|potatoes|beetroots|melon|pumpkin|cactus|sugarcane|bamboo|kelp|vine|nether_wart|crop/.test(n), toolType: 'hoe', canHandMine: true },
  // 玻璃类
  { match: (n) => /glass/.test(n), toolType: 'pickaxe', canHandMine: false },
  // 黑曜石
  { match: (n) => n === 'obsidian', toolType: 'pickaxe', canHandMine: false },
];

/** 材料替代映射：同功能材料分组 */
const BLOCK_ALTERNATIVES: Record<string, string[]> = {
  oak_planks: ['birch_planks', 'spruce_planks', 'jungle_planks', 'acacia_planks', 'dark_oak_planks', 'mangrove_planks', 'cherry_planks', 'bamboo_planks', 'crimson_planks', 'warped_planks'],
  birch_planks: ['oak_planks', 'spruce_planks', 'jungle_planks', 'acacia_planks', 'dark_oak_planks', 'mangrove_planks', 'cherry_planks', 'bamboo_planks', 'crimson_planks', 'warped_planks'],
  spruce_planks: ['oak_planks', 'birch_planks', 'jungle_planks', 'acacia_planks', 'dark_oak_planks', 'mangrove_planks', 'cherry_planks', 'bamboo_planks', 'crimson_planks', 'warped_planks'],
  jungle_planks: ['oak_planks', 'birch_planks', 'spruce_planks', 'acacia_planks', 'dark_oak_planks', 'mangrove_planks', 'cherry_planks', 'bamboo_planks', 'crimson_planks', 'warped_planks'],
  acacia_planks: ['oak_planks', 'birch_planks', 'spruce_planks', 'jungle_planks', 'dark_oak_planks', 'mangrove_planks', 'cherry_planks', 'bamboo_planks', 'crimson_planks', 'warped_planks'],
  dark_oak_planks: ['oak_planks', 'birch_planks', 'spruce_planks', 'jungle_planks', 'acacia_planks', 'mangrove_planks', 'cherry_planks', 'bamboo_planks', 'crimson_planks', 'warped_planks'],
  stone: ['cobblestone', 'stone', 'smooth_stone', 'deepslate', 'cobbled_deepslate'],
  cobblestone: ['stone', 'cobblestone', 'deepslate', 'cobbled_deepslate'],
  dirt: ['dirt', 'grass_block', 'podzol', 'mycelium', 'coarse_dirt', 'rooted_dirt'],
  grass_block: ['dirt', 'grass_block', 'podzol', 'mycelium', 'coarse_dirt'],
  oak_log: ['birch_log', 'spruce_log', 'jungle_log', 'acacia_log', 'dark_oak_log', 'mangrove_log', 'cherry_log'],
  glass: ['glass', 'white_stained_glass', 'orange_stained_glass', 'light_blue_stained_glass', 'yellow_stained_glass', 'lime_stained_glass', 'pink_stained_glass', 'gray_stained_glass', 'light_gray_stained_glass', 'cyan_stained_glass', 'purple_stained_glass', 'blue_stained_glass', 'brown_stained_glass', 'green_stained_glass', 'red_stained_glass', 'black_stained_glass'],
  torch: ['torch', 'soul_torch', 'redstone_torch'],
};

export class ToolSelector {
  /**
   * 判断方块是否不可破坏
   */
  isUnbreakable(blockName: string): boolean {
    const normalized = normalizeName(blockName);
    return UNBREAKABLE_BLOCKS.has(normalized);
  }

  /**
   * 获取方块对应的工具类型与是否可手挖
   */
  private getBlockRule(blockName: string): { toolType: string | null; canHandMine: boolean } {
    const normalized = normalizeName(blockName);
    if (normalized === 'air') return { toolType: null, canHandMine: true };

    for (const rule of BLOCK_TOOL_RULES) {
      if (rule.match(normalized)) {
        return { toolType: rule.toolType, canHandMine: rule.canHandMine };
      }
    }

    // 默认允许手挖
    return { toolType: null, canHandMine: true };
  }

  /**
   * 根据方块类型与背包内容选择最优工具
   */
  selectToolForBlock(blockName: string, inventory: ItemStack[]): ToolRecommendation {
    const rule = this.getBlockRule(blockName);

    if (!rule.toolType) {
      return { toolSlot: null, canHandMine: rule.canHandMine };
    }

    const candidates = inventory
      .filter((item) => this.isToolOfType(item.name, rule.toolType!))
      .sort((a, b) => this.toolPriority(b.name) - this.toolPriority(a.name));

    if (candidates.length === 0) {
      return { toolSlot: null, canHandMine: rule.canHandMine };
    }

    const best = candidates[0];
    return {
      toolSlot: best.slot,
      canHandMine: rule.canHandMine,
      toolName: best.name,
    };
  }

  /**
   * 当首选工具耐久不足时，寻找背包中其他可用工具
   */
  findAlternativeTool(
    blockName: string,
    inventory: ItemStack[],
    excludeSlot?: number,
  ): { slot: number; name: string } | null {
    const rule = this.getBlockRule(blockName);
    if (!rule.toolType) return null;

    const candidates = inventory
      .filter((item) => item.slot !== excludeSlot && this.isToolOfType(item.name, rule.toolType!))
      .sort((a, b) => this.toolPriority(b.name) - this.toolPriority(a.name));

    if (candidates.length === 0) return null;
    return { slot: candidates[0].slot, name: candidates[0].name };
  }

  /**
   * 当指定方块不足时尝试同功能替代
   */
  selectAlternativeBlock(blockName: string, inventory: ItemStack[]): string | null {
    const normalized = normalizeName(blockName);
    const alternatives = BLOCK_ALTERNATIVES[normalized] || this.findGroupAlternative(normalized);

    for (const alt of alternatives) {
      const found = inventory.find((item) => normalizeName(item.name) === normalizeName(alt));
      if (found) return alt;
    }

    return null;
  }

  /**
   * 判断物品是否属于指定工具类型
   */
  private isToolOfType(itemName: string, toolType: string): boolean {
    const normalized = normalizeName(itemName);
    // 例如 netherite_pickaxe, iron_axe, shears
    if (toolType === 'shears') return normalized === 'shears';
    return normalized.endsWith(`_${toolType}`);
  }

  /**
   * 计算工具优先级（材料等级）
   */
  private toolPriority(itemName: string): number {
    const normalized = normalizeName(itemName);
    for (const [prefix, priority] of Object.entries(TOOL_PRIORITY)) {
      if (normalized.startsWith(`${prefix}_`)) return priority;
    }
    return 0;
  }

  /**
   * 通用分组替代：按名称前缀/后缀匹配
   */
  private findGroupAlternative(normalized: string): string[] {
    if (normalized.endsWith('_planks')) {
      return Object.keys(BLOCK_ALTERNATIVES).filter((k) => k.endsWith('_planks'));
    }
    if (normalized.endsWith('_log')) {
      return ['oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log', 'dark_oak_log', 'mangrove_log', 'cherry_log'];
    }
    if (normalized.endsWith('_stained_glass')) {
      return BLOCK_ALTERNATIVES.glass || [];
    }
    return [];
  }
}
