/**
 * BlockOperationEngine 单元测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BlockOperationEngine } from '../../src/ai/block/BlockOperationEngine.js';
import { InventoryEngine } from '../../src/ai/inventory/InventoryEngine.js';
import { BotManager } from '../../src/bot/BotManager.js';
import type { Vec3 } from '../../src/ai/pathfinding/types.js';
import { aiEngine } from '../../src/ai/index.js';

function createFakeItem(name: string, count: number): any {
  return {
    name,
    count,
    isNull: () => count <= 0,
    clone: () => createFakeItem(name, count),
    getDamage: () => 0,
    getMaxDamage: () => 250,
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
    simulateDestroyBlock: vi.fn(),
    simulatePlaceBlock: vi.fn(),
    simulateInteract: vi.fn(),
    simulateLookAt: vi.fn(),
    lookAt: vi.fn(),
    getHand: vi.fn(() => createFakeItem('', 0)),
    getOffHand: vi.fn(() => createFakeContainer(1)),
    getInventory: vi.fn(() => createFakeContainer(36, inventoryItems)),
    getArmor: vi.fn(() => createFakeContainer(4)),
    ...overrides,
  };
}

function createFakeWorld(blocks: Record<string, string>) {
  return {
    getBlock: vi.fn((x: number, y: number, z: number) => {
      const key = `${x},${y},${z}`;
      return { name: blocks[key] ?? 'air', pos: { x, y, z } };
    }),
  };
}

describe('BlockOperationEngine', () => {
  beforeEach(() => {
    BotManager.init();
    vi.restoreAllMocks();
    // 默认让 aiEngine.moveTo 直接成功，避免真正移动逻辑
    vi.spyOn(aiEngine, 'moveTo').mockResolvedValue({
      success: true,
      finalPos: { x: 0, y: 64, z: 0 },
      distanceMoved: 0,
      durationMs: 0,
      hungerCost: 0,
      reason: 'success',
    });
  });

  it('mineBlock 应挖掘石头方块并返回成功', async () => {
    const world = createFakeWorld({ '1,64,1': 'stone', '0,64,1': 'stone' });
    const player = createFakePlayer({
      inventoryItems: {
        0: createFakeItem('iron_pickaxe', 1),
      },
    });
    // 破坏后 world 状态会变化，模拟 confirmBroken 返回 true
    const validator = {
      confirmBroken: vi.fn(() => true),
      confirmPlaced: vi.fn(() => true),
      findPlacementFace: vi.fn(() => ({ face: { x: -1, y: 0, z: 0 }, neighbor: { x: 0, y: 64, z: 1 } })),
      isReachable: vi.fn(() => true),
    };
    const inventory = new InventoryEngine(player, 'TestBot');
    const engine = new BlockOperationEngine({ player, botName: 'TestBot', inventoryEngine: inventory, world });
    (engine as any).blockValidator = validator;

    const result = await engine.mineBlock({ x: 1, y: 64, z: 1 });
    expect(result.success).toBe(true);
    expect(result.block).toBe('stone');
    expect(player.simulateDestroyBlock).toHaveBeenCalled();
  });

  it('mineBlock 空气方块应直接成功', async () => {
    const world = createFakeWorld({});
    const player = createFakePlayer();
    const inventory = new InventoryEngine(player, 'TestBot');
    const engine = new BlockOperationEngine({ player, botName: 'TestBot', inventoryEngine: inventory, world });

    const result = await engine.mineBlock({ x: 1, y: 64, z: 1 });
    expect(result.success).toBe(true);
    expect(result.block).toBe('air');
  });

  it('mineBlock 基岩应返回 BLOCK_UNBREAKABLE', async () => {
    const world = createFakeWorld({ '1,64,1': 'bedrock' });
    const player = createFakePlayer();
    const inventory = new InventoryEngine(player, 'TestBot');
    const engine = new BlockOperationEngine({ player, botName: 'TestBot', inventoryEngine: inventory, world });

    const result = await engine.mineBlock({ x: 1, y: 64, z: 1 });
    expect(result.success).toBe(false);
    expect(result.error).toBe('BLOCK_UNBREAKABLE');
  });

  it('mineBlock 黑曜石无镐时应返回 NO_SUITABLE_TOOL', async () => {
    const world = createFakeWorld({ '1,64,1': 'obsidian' });
    const player = createFakePlayer();
    const inventory = new InventoryEngine(player, 'TestBot');
    const engine = new BlockOperationEngine({ player, botName: 'TestBot', inventoryEngine: inventory, world });

    const result = await engine.mineBlock({ x: 1, y: 64, z: 1 });
    expect(result.success).toBe(false);
    expect(result.error).toBe('NO_SUITABLE_TOOL');
  });

  it('placeBlock 应放置泥土方块', async () => {
    const world = createFakeWorld({ '0,64,0': 'stone' });
    const player = createFakePlayer({
      inventoryItems: { 0: createFakeItem('dirt', 10) },
    });
    const validator = {
      confirmBroken: vi.fn(() => true),
      confirmPlaced: vi.fn(() => true),
      findPlacementFace: vi.fn(() => ({ face: { x: -1, y: 0, z: 0 }, neighbor: { x: 0, y: 64, z: 0 } })),
      isReachable: vi.fn(() => true),
    };
    const inventory = new InventoryEngine(player, 'TestBot');
    const engine = new BlockOperationEngine({ player, botName: 'TestBot', inventoryEngine: inventory, world });
    (engine as any).blockValidator = validator;

    const result = await engine.placeBlock({ x: 1, y: 64, z: 0 }, 'dirt');
    expect(result.success).toBe(true);
    expect(result.block).toBe('dirt');
    expect(player.simulatePlaceBlock).toHaveBeenCalled();
  });

  it('placeBlock 无材料时应返回 ITEM_NOT_FOUND', async () => {
    const world = createFakeWorld({ '0,64,0': 'stone' });
    const player = createFakePlayer();
    const inventory = new InventoryEngine(player, 'TestBot');
    const engine = new BlockOperationEngine({ player, botName: 'TestBot', inventoryEngine: inventory, world });

    const result = await engine.placeBlock({ x: 1, y: 64, z: 0 }, 'dirt');
    expect(result.success).toBe(false);
    expect(result.error).toBe('ITEM_NOT_FOUND');
  });

  it('useBlock 应对门执行交互', async () => {
    const world = createFakeWorld({ '1,64,1': 'oak_door' });
    const player = createFakePlayer();
    const inventory = new InventoryEngine(player, 'TestBot');
    const engine = new BlockOperationEngine({ player, botName: 'TestBot', inventoryEngine: inventory, world });

    const result = await engine.useBlock({ x: 1, y: 64, z: 1 });
    expect(result.success).toBe(true);
    expect(result.block).toBe('oak_door');
    expect(player.simulateInteract).toHaveBeenCalled();
  });

  it('areaOperation fill 应逐格放置', async () => {
    const world = createFakeWorld({
      '0,64,0': 'stone',
      '1,64,0': 'stone',
      '0,64,1': 'stone',
      '1,64,1': 'stone',
    });
    const player = createFakePlayer({
      inventoryItems: { 0: createFakeItem('oak_planks', 64) },
    });
    const validator = {
      confirmBroken: vi.fn(() => true),
      confirmPlaced: vi.fn(() => true),
      findPlacementFace: vi.fn(() => ({ face: { x: -1, y: 0, z: 0 }, neighbor: { x: 0, y: 64, z: 0 } })),
      isReachable: vi.fn(() => true),
    };
    const inventory = new InventoryEngine(player, 'TestBot');
    const engine = new BlockOperationEngine({ player, botName: 'TestBot', inventoryEngine: inventory, world });
    (engine as any).blockValidator = validator;

    const result = await engine.areaOperation(
      'fill',
      { x: 0, y: 65, z: 0 },
      { x: 1, y: 65, z: 1 },
      'oak_planks',
    );
    expect(result.success).toBe(true);
    expect(result.total_blocks).toBe(4);
    expect(result.success_count).toBe(4);
    expect(result.fail_count).toBe(0);
  });

  it('areaOperation break 应逐格破坏并汇总掉落物', async () => {
    const world = createFakeWorld({
      '0,64,0': 'stone',
      '1,64,0': 'stone',
      '0,64,1': 'stone',
      '1,64,1': 'stone',
    });
    const player = createFakePlayer({
      inventoryItems: { 0: createFakeItem('iron_pickaxe', 1) },
    });
    const validator = {
      confirmBroken: vi.fn(() => true),
      confirmPlaced: vi.fn(() => true),
      findPlacementFace: vi.fn(() => null),
      isReachable: vi.fn(() => true),
    };
    const inventory = new InventoryEngine(player, 'TestBot');
    const engine = new BlockOperationEngine({ player, botName: 'TestBot', inventoryEngine: inventory, world });
    (engine as any).blockValidator = validator;

    const result = await engine.areaOperation(
      'break',
      { x: 0, y: 64, z: 0 },
      { x: 1, y: 64, z: 1 },
    );
    expect(result.success).toBe(true);
    expect(result.total_blocks).toBe(4);
    expect(result.success_count).toBe(4);
    expect(result.drops).toBeDefined();
    expect(result.drops!['cobblestone']).toBeGreaterThan(0);
  });

  it('areaOperation 超过体积上限应返回 AREA_TOO_LARGE', async () => {
    const world = createFakeWorld({});
    const player = createFakePlayer();
    const inventory = new InventoryEngine(player, 'TestBot');
    const engine = new BlockOperationEngine({ player, botName: 'TestBot', inventoryEngine: inventory, world });

    const result = await engine.areaOperation(
      'fill',
      { x: 0, y: 64, z: 0 },
      { x: 20, y: 64, z: 20 },
      'stone',
    );
    expect(result.success).toBe(false);
    expect(result.error).toBe('AREA_TOO_LARGE');
  });
});
