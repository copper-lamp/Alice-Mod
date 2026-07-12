/**
 * InventoryEngine 单元测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import '../setup.js';
import { InventoryEngine, normalizeName, matchName } from '../../src/ai/inventory/InventoryEngine.js';
import { BotManager } from '../../src/bot/BotManager.js';

function createFakeItem(name: string, count: number): any {
  return {
    name,
    count,
    isNull: function () {
      return this.count <= 0;
    },
    clone: function () {
      return createFakeItem(this.name, this.count);
    },
  };
}

function createFakeContainer(size: number, items: Record<number, any> = {}) {
  const slots: any[] = new Array(size).fill(null).map(() => createFakeItem('', 0));
  for (const [slot, item] of Object.entries(items)) {
    slots[Number(slot)] = item;
  }

  const setSlot = (i: number, item: any) => {
    slots[i] = item ?? createFakeItem('', 0);
    return true;
  };

  return {
    size,
    getItem: (i: number) => slots[i],
    setItem: setSlot,
    setSlot,
    removeItem: (i: number, count: number) => {
      const item = slots[i];
      if (!item || item.count < count) return false;
      item.count -= count;
      if (item.count <= 0) {
        slots[i] = createFakeItem('', 0);
      }
      return true;
    },
    addItem: (item: any) => {
      for (let i = 0; i < size; i++) {
        if (slots[i].isNull()) {
          slots[i] = item;
          return true;
        }
      }
      return false;
    },
  };
}

function createFakePlayerWithInventory(inventoryItems: Record<number, any> = {}, armorItems: Record<number, any> = {}) {
  const inventory = createFakeContainer(36, inventoryItems);
  const armor = createFakeContainer(4, armorItems);

  return {
    realName: 'TestBot',
    name: 'TestBot',
    pos: { x: 0, y: 64, z: 0, dimid: 0 },
    direction: { yaw: 0, pitch: 0 },
    selectedSlot: 0,
    getHand: () => inventory.getItem(0),
    getInventory: () => inventory,
    getArmor: () => armor,
    getOffHand: () => createFakeItem('', 0),
    isSimulatedPlayer: () => true,
  };
}

describe('InventoryEngine', () => {
  beforeEach(() => {
    BotManager.init();
    vi.restoreAllMocks();
  });

  it('应能列出背包物品', () => {
    const player = createFakePlayerWithInventory({ 0: createFakeItem('cobblestone', 32) });
    const engine = new InventoryEngine(player as Player, 'TestBot');

    const list = engine.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: 'cobblestone', count: 32, source: 'inventory' });
  });

  it('find 应支持忽略 minecraft: 前缀', () => {
    const player = createFakePlayerWithInventory({ 5: createFakeItem('minecraft:stone', 10) });
    const engine = new InventoryEngine(player as Player, 'TestBot');

    const found = engine.find('stone');
    expect(found).not.toBeNull();
    expect(found?.slot).toBe(5);
  });

  it('drop 应减少背包物品数量', () => {
    const player = createFakePlayerWithInventory({ 0: createFakeItem('cobblestone', 64) });
    const engine = new InventoryEngine(player as Player, 'TestBot');

    const result = engine.drop('cobblestone', 10);
    expect(result.success).toBe(true);
    expect(result.dropped).toBe(10);
    expect(result.remaining).toBe(54);
    expect(player.getInventory().getItem(0).count).toBe(54);
  });

  it('drop 未指定物品时应丢弃主手物品', () => {
    const player = createFakePlayerWithInventory({ 0: createFakeItem('dirt', 12) });
    const engine = new InventoryEngine(player as Player, 'TestBot');

    const result = engine.drop(undefined, 5);
    expect(result.success).toBe(true);
    expect(result.item).toBe('dirt');
    expect(result.dropped).toBe(5);
  });

  it('equip 应将物品装备到指定部位并卸下旧装备', () => {
    const player = createFakePlayerWithInventory(
      { 0: createFakeItem('iron_helmet', 1) },
      { 0: createFakeItem('leather_helmet', 1) },
    );
    const engine = new InventoryEngine(player as Player, 'TestBot');

    const result = engine.equip('iron_helmet', 'head');
    expect(result.success).toBe(true);
    expect(result.slot).toBe('head');
    expect(player.getArmor().getItem(0).name).toBe('iron_helmet');
    // 旧装备应被移回背包（slot 0 已被 iron_helmet 占据，因此放入 slot 1）
    expect(player.getInventory().getItem(1).name).toBe('leather_helmet');
  });

  it('unequip 应将装备移回背包', () => {
    const player = createFakePlayerWithInventory({}, { 2: createFakeItem('iron_leggings', 1) });
    const engine = new InventoryEngine(player as Player, 'TestBot');

    const result = engine.unequip('legs');
    expect(result.success).toBe(true);
    expect(result.item).toBe('iron_leggings');
    expect(player.getArmor().getItem(2).isNull()).toBe(true);
    expect(player.getInventory().getItem(0).name).toBe('iron_leggings');
  });

  it('装备物品不存在时应失败', () => {
    const player = createFakePlayerWithInventory();
    const engine = new InventoryEngine(player as Player, 'TestBot');

    const result = engine.equip('diamond_helmet', 'head');
    expect(result.success).toBe(false);
    expect(result.error).toContain('未找到');
  });

  it('normalizeName 应去除命名空间和空格', () => {
    expect(normalizeName('minecraft:Stone Brick')).toBe('stone_brick');
    expect(normalizeName('  Cobblestone  ')).toBe('cobblestone');
  });

  it('matchName 应支持忽略下划线差异', () => {
    expect(matchName('stone_bricks', 'stonebricks')).toBe(true);
    expect(matchName('minecraft:cobblestone', 'cobblestone')).toBe(true);
    expect(matchName('dirt', 'stone')).toBe(false);
  });
});
