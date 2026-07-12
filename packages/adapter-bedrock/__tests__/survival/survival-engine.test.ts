/**
 * SurvivalEngine 单元测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SurvivalEngine } from '../../src/ai/survival/SurvivalEngine.js';
import { InventoryEngine } from '../../src/ai/inventory/InventoryEngine.js';
import { BotManager } from '../../src/bot/BotManager.js';
import type { WorldAccess } from '../../src/registry/tool-module.types.js';
import { aiEngine } from '../../src/ai/index.js';

function createFakeItem(name: string, count: number): any {
  return {
    name,
    count,
    isNull: () => count <= 0,
    clone: () => createFakeItem(name, count),
  };
}

function createFakeContainer(size: number, items: Record<number, any> = {}) {
  const slots: any[] = new Array(size).fill(null).map(() => createFakeItem('', 0));
  for (const [slot, item] of Object.entries(items)) {
    slots[Number(slot)] = item;
  }

  return {
    size,
    getItem: (i: number) => slots[i],
    setItem: (i: number, item: any) => { slots[i] = item ?? createFakeItem('', 0); return true; },
    removeItem: (i: number, count: number) => {
      const item = slots[i];
      if (!item || item.count < count) return false;
      item.count -= count;
      if (item.count <= 0) slots[i] = createFakeItem('', 0);
      return true;
    },
  };
}

function createFakePlayer(overrides: Partial<any> = {}): any {
  const inventoryItems = overrides.inventoryItems ?? {};
  return {
    name: 'TestBot',
    pos: { x: 0, y: 64, z: 0, dimid: 0 },
    selectedSlot: 0,
    getHunger: vi.fn(() => overrides.hunger ?? 20),
    getSaturation: vi.fn(() => overrides.saturation ?? 0),
    simulateUseItem: vi.fn(),
    simulateSleep: vi.fn(),
    sleep: vi.fn(),
    wake: vi.fn(),
    isSleeping: vi.fn(() => false),
    getHand: vi.fn(() => createFakeItem('', 0)),
    getOffHand: vi.fn(() => createFakeContainer(1)),
    getInventory: vi.fn(() => createFakeContainer(36, inventoryItems)),
    getArmor: vi.fn(() => createFakeContainer(4)),
    ...overrides,
  };
}

function createFakeWorld(overrides: Partial<WorldAccess> = {}): WorldAccess {
  return {
    getBlock: vi.fn(() => ({ name: 'air' })),
    getTime: vi.fn(() => 18000),
    getWeather: vi.fn(() => 'clear'),
    getEntities: vi.fn(() => []),
    getOnlinePlayers: vi.fn(() => []),
    ...overrides,
  };
}

describe('SurvivalEngine', () => {
  beforeEach(() => {
    BotManager.init();
    vi.restoreAllMocks();
  });

  it('eat 应自动选择评分最高食物', async () => {
    const player = createFakePlayer({
      inventoryItems: {
        0: createFakeItem('apple', 5),
        1: createFakeItem('cooked_beef', 3),
      },
      hunger: 10,
      saturation: 0,
    });
    player.getHunger = vi.fn()
      .mockReturnValueOnce(10)
      .mockReturnValueOnce(10)
      .mockReturnValue(18);
    player.getSaturation = vi.fn()
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValue(12.8);

    const inventory = new InventoryEngine(player, 'TestBot');
    const engine = new SurvivalEngine({ player, botName: 'TestBot', inventoryEngine: inventory, world: createFakeWorld() });

    const result = await engine.eat();
    expect(result.success).toBe(true);
    expect(result.item).toBe('cooked_beef');
  });

  it('eat 指定不存在食物时应失败', async () => {
    const player = createFakePlayer({ inventoryItems: { 0: createFakeItem('apple', 1) } });
    const inventory = new InventoryEngine(player, 'TestBot');
    const engine = new SurvivalEngine({ player, botName: 'TestBot', inventoryEngine: inventory, world: createFakeWorld() });

    const result = await engine.eat('cooked_beef');
    expect(result.success).toBe(false);
    expect(result.error).toBe('NO_FOOD');
  });

  it('eat 指定不可食用物品时应失败', async () => {
    const player = createFakePlayer({ inventoryItems: { 0: createFakeItem('stone', 1) } });
    const inventory = new InventoryEngine(player, 'TestBot');
    const engine = new SurvivalEngine({ player, botName: 'TestBot', inventoryEngine: inventory, world: createFakeWorld() });

    const result = await engine.eat('stone');
    expect(result.success).toBe(false);
    expect(result.error).toBe('CANNOT_EAT');
  });

  it('sleep 在白昼应返回 NOT_SLEEP_TIME', async () => {
    const player = createFakePlayer();
    const world = createFakeWorld({
      getBlock: vi.fn((x: number, y: number, z: number) => {
        if (x === 2 && y === 64 && z === 2) return { name: 'white_bed' };
        return { name: 'air' };
      }),
      getTime: vi.fn(() => 6000),
    });
    const inventory = new InventoryEngine(player, 'TestBot');
    const engine = new SurvivalEngine({ player, botName: 'TestBot', inventoryEngine: inventory, world });

    vi.spyOn(aiEngine, 'moveTo').mockResolvedValue({
      success: true,
      finalPos: { x: 2, y: 64, z: 2 },
      distanceMoved: 0,
      durationMs: 0,
      hungerCost: 0,
      reason: 'success',
    });

    const result = await engine.sleep('sleep', { x: 2, y: 64, z: 2 });
    expect(result.success).toBe(false);
    expect(result.error).toBe('NOT_SLEEP_TIME');
  });

  it('sleep 在夜晚无怪物时应成功', async () => {
    const player = createFakePlayer({
      isSleeping: vi.fn()
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(true)
        .mockReturnValue(false),
    });
    const world = createFakeWorld({
      getBlock: vi.fn((x: number, y: number, z: number) => {
        if (x === 2 && y === 64 && z === 2) return { name: 'white_bed' };
        return { name: 'air' };
      }),
      getTime: vi.fn(() => 18000),
    });
    const inventory = new InventoryEngine(player, 'TestBot');
    const engine = new SurvivalEngine({ player, botName: 'TestBot', inventoryEngine: inventory, world });

    vi.spyOn(aiEngine, 'moveTo').mockResolvedValue({
      success: true,
      finalPos: { x: 2, y: 64, z: 2 },
      distanceMoved: 0,
      durationMs: 0,
      hungerCost: 0,
      reason: 'success',
    });

    const result = await engine.sleep('sleep', { x: 2, y: 64, z: 2 });
    expect(result.success).toBe(true);
    expect(player.sleep).toHaveBeenCalled();
  });

  it('sleep wake 应调用 wake 并立即成功', async () => {
    const player = createFakePlayer();
    const inventory = new InventoryEngine(player, 'TestBot');
    const engine = new SurvivalEngine({ player, botName: 'TestBot', inventoryEngine: inventory, world: createFakeWorld() });

    const result = await engine.sleep('wake');
    expect(result.success).toBe(true);
    expect(player.wake).toHaveBeenCalled();
  });

  it('sleep 找不到床时应返回 NO_BED', async () => {
    const player = createFakePlayer();
    const inventory = new InventoryEngine(player, 'TestBot');
    const engine = new SurvivalEngine({ player, botName: 'TestBot', inventoryEngine: inventory, world: createFakeWorld() });

    const result = await engine.sleep('sleep');
    expect(result.success).toBe(false);
    expect(result.error).toBe('NO_BED');
  });

  it('useItem 普通使用应调用 simulateUseItem', async () => {
    const player = createFakePlayer({
      inventoryItems: { 0: createFakeItem('ender_pearl', 1) },
    });
    const inventory = new InventoryEngine(player, 'TestBot');
    const engine = new SurvivalEngine({ player, botName: 'TestBot', inventoryEngine: inventory, world: createFakeWorld() });

    const result = await engine.useItem('ender_pearl', 'use');
    expect(result.success).toBe(true);
    expect(result.item).toBe('ender_pearl');
    expect(result.mode).toBe('use');
    expect(player.simulateUseItem).toHaveBeenCalled();
  });

  it('useItem 投掷缺少目标时应失败', async () => {
    const player = createFakePlayer({
      inventoryItems: { 0: createFakeItem('snowball', 3) },
    });
    const inventory = new InventoryEngine(player, 'TestBot');
    const engine = new SurvivalEngine({ player, botName: 'TestBot', inventoryEngine: inventory, world: createFakeWorld() });

    const result = await engine.useItem('snowball', 'throw');
    expect(result.success).toBe(false);
    expect(result.error).toBe('TARGET_REQUIRED');
  });

  it('useItem 物品不存在时应失败', async () => {
    const player = createFakePlayer();
    const inventory = new InventoryEngine(player, 'TestBot');
    const engine = new SurvivalEngine({ player, botName: 'TestBot', inventoryEngine: inventory, world: createFakeWorld() });

    const result = await engine.useItem('potion', 'drink');
    expect(result.success).toBe(false);
    expect(result.error).toBe('ITEM_NOT_FOUND');
  });
});
