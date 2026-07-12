/**
 * ContainerAPI 单元测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import '../setup.js';
import { ContainerAPI } from '../../src/ai/inventory/ContainerAPI.js';

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

function createFakePlayer(inventoryItems: Record<number, any> = {}) {
  const inventory = createFakeContainer(36, inventoryItems);
  return {
    realName: 'TestBot',
    name: 'TestBot',
    pos: { x: 1, y: 64, z: 1, dimid: 0 },
    direction: { yaw: 0, pitch: 0 },
    getInventory: () => inventory,
    getArmor: () => createFakeContainer(4),
    getOffHand: () => createFakeItem('', 0),
  };
}

function createFakeBlock(container: any) {
  return {
    getPos: () => ({ x: 2, y: 64, z: 2 }),
    getContainer: () => container,
  };
}

describe('ContainerAPI', () => {
  beforeEach(() => {
    // setup.js 已初始化全局 mock
  });

  it('take 应按名称从容器取出物品到背包', () => {
    const player = createFakePlayer();
    const container = createFakeContainer(27, { 3: createFakeItem('cobblestone', 32) });
    const block = createFakeBlock(container);
    const api = new ContainerAPI(player as Player);

    expect(api.open(block)).not.toBeNull();
    const result = api.take(container, 'cobblestone', 10);
    expect(result.success).toBe(true);
    expect(result.transferred).toBe(10);
    expect(container.getItem(3).count).toBe(22);
    expect(player.getInventory().getItem(0).name).toBe('cobblestone');
    expect(player.getInventory().getItem(0).count).toBe(10);
  });

  it('take 应遵守背包堆叠上限并拆分', () => {
    const player = createFakePlayer({ 0: createFakeItem('cobblestone', 60) });
    const inventory = player.getInventory();
    const container = createFakeContainer(27, { 0: createFakeItem('cobblestone', 32) });
    const block = createFakeBlock(container);
    const api = new ContainerAPI(player as Player);

    api.open(block);
    const result = api.take(container, 'cobblestone', 10);
    expect(result.success).toBe(true);
    expect(result.transferred).toBe(10);
    expect(inventory.getItem(0).count).toBe(64);
    expect(inventory.getItem(1).count).toBe(6);
  });

  it('put 应按名称将背包物品放入容器', () => {
    const player = createFakePlayer({ 0: createFakeItem('dirt', 20) });
    const container = createFakeContainer(27);
    const block = createFakeBlock(container);
    const api = new ContainerAPI(player as Player);

    api.open(block);
    const result = api.put(container, 'dirt', 8);
    expect(result.success).toBe(true);
    expect(result.transferred).toBe(8);
    expect(player.getInventory().getItem(0).count).toBe(12);
    expect(container.getItem(0).name).toBe('dirt');
    expect(container.getItem(0).count).toBe(8);
  });

  it('put 应合并到容器中已有同类物品槽位', () => {
    const player = createFakePlayer({ 0: createFakeItem('cobblestone', 40) });
    const container = createFakeContainer(27, { 5: createFakeItem('cobblestone', 40) });
    const block = createFakeBlock(container);
    const api = new ContainerAPI(player as Player);

    api.open(block);
    const result = api.put(container, 'cobblestone', 30);
    expect(result.success).toBe(true);
    expect(result.transferred).toBe(30); // 24 合并到槽 5，6 放入新槽
    expect(container.getItem(5).count).toBe(64);
    expect(container.getItem(0).count).toBe(6);
    expect(player.getInventory().getItem(0).count).toBe(10);
  });

  it('距离过远时 open 应返回 null', () => {
    const player = {
      ...createFakePlayer(),
      pos: { x: 100, y: 64, z: 100, dimid: 0 },
    };
    const container = createFakeContainer(27);
    const block = createFakeBlock(container);
    const api = new ContainerAPI(player as Player);

    expect(api.open(block)).toBeNull();
  });

  it('容器中没有指定物品时应失败', () => {
    const player = createFakePlayer();
    const container = createFakeContainer(27, { 0: createFakeItem('dirt', 10) });
    const block = createFakeBlock(container);
    const api = new ContainerAPI(player as Player);

    api.open(block);
    const result = api.take(container, 'cobblestone');
    expect(result.success).toBe(false);
    expect(result.error).toContain('没有');
  });
});
