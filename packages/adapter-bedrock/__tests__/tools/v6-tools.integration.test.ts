/**
 * V6 工具层集成测试
 *
 * 覆盖 eat / sleep / use_item / mine_block / place_block / use_block / area_operation
 * 七个工具的完整执行链路：Tool -> Engine -> Player/World 交互。
 * 通过可变世界状态与玩家模拟回调，验证工具在成功路径下的返回结果。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import '../setup.js';
import type { ToolContext, BotAccess, WorldAccess } from '../../src/registry/tool-module.types.js';
import { ToolContextImpl } from '../../src/registry/tool-context.js';
import { BotManager } from '../../src/bot/BotManager.js';
import { aiEngine } from '../../src/ai/index.js';
import { resetMcState, setOnlinePlayers } from '../setup.js';

import EatTool from '../../src/tools/survival/eat/index.js';
import SleepTool from '../../src/tools/survival/sleep/index.js';
import UseItemTool from '../../src/tools/survival/use-item/index.js';
import MineBlockTool from '../../src/tools/block/mine-block/index.js';
import PlaceBlockTool from '../../src/tools/block/place-block/index.js';
import UseBlockTool from '../../src/tools/block/use-block/index.js';
import AreaOperationTool from '../../src/tools/block/area-operation/index.js';

const BOT_NAME = 'TestBot';

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
    selectedSlot: 0,
    getItem: (i: number) => slots[i] ?? createFakeItem('', 0),
    setItem: (i: number, item: any) => {
      slots[i] = item ?? createFakeItem('', 0);
      return true;
    },
    setSlot: (i: number, item: any) => {
      slots[i] = item ?? createFakeItem('', 0);
      return true;
    },
    removeItem: (i: number, count: number) => {
      const item = slots[i];
      if (!item || item.count < count) return false;
      item.count -= count;
      if (item.count <= 0) slots[i] = createFakeItem('', 0);
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

function createFakePlayer(overrides: Partial<any> = {}): any {
  const inventoryItems = overrides.inventoryItems ?? {};
  const container = createFakeContainer(36, inventoryItems);
  const armor = createFakeContainer(4);
  const offhand = createFakeContainer(1);

  return {
    realName: BOT_NAME,
    name: BOT_NAME,
    pos: overrides.pos ?? { x: 0, y: 64, z: 0, dimid: 0 },
    direction: overrides.direction ?? { yaw: 0, pitch: 0 },
    selectedSlot: 0,
    health: overrides.health ?? 20,
    maxHealth: overrides.maxHealth ?? 20,
    hunger: overrides.hunger ?? 20,
    saturation: overrides.saturation ?? 0,
    isSimulatedPlayer: () => true,
    getHealth: () => overrides.health ?? 20,
    getMaxHealth: () => overrides.maxHealth ?? 20,
    getHunger: overrides.getHunger ?? (() => 20),
    getSaturation: overrides.getSaturation ?? (() => 0),
    getAir: () => 300,
    getHand: () => container.getItem(container.selectedSlot),
    getOffHand: () => offhand,
    getInventory: () => container,
    getArmor: () => armor,
    setSelectedSlot: (slot: number) => {
      container.selectedSlot = slot;
      return true;
    },
    simulateUseItem: vi.fn(),
    simulateDestroyBlock: vi.fn(),
    simulatePlaceBlock: vi.fn(),
    simulateInteract: vi.fn(),
    simulateLookAt: vi.fn(),
    simulateSetBodyRotation: vi.fn(),
    lookAt: vi.fn(),
    sleep: vi.fn(),
    wake: vi.fn(),
    isSleeping: () => false,
    teleport: vi.fn(() => true),
    simulateDisconnect: vi.fn(() => true),
    refreshItems: vi.fn(),
    getNbt: () => new (globalThis as any).NbtCompound(),
    setNbt: vi.fn(() => true),
    ...overrides,
  };
}

function createMutableWorld(initialBlocks: Record<string, string> = {}) {
  const blocks: Record<string, string> = { ...initialBlocks };

  return {
    blocks,
    getBlock: vi.fn((x: number, y: number, z: number) => {
      const key = `${x},${y},${z}`;
      return { name: blocks[key] ?? 'air', pos: { x, y, z } };
    }),
    setBlock: (x: number, y: number, z: number, name: string) => {
      blocks[`${x},${y},${z}`] = name;
    },
    getTime: vi.fn(() => 0),
    getWeather: vi.fn(() => 'clear'),
    getEntities: vi.fn(() => []),
    getOnlinePlayers: vi.fn(() => []),
  };
}

class StaticBotAccess implements BotAccess {
  constructor(private player: any, private name: string) {}

  getActiveBot(): any {
    return { name: this.name, getPlayer: () => this.player, isOnline: true };
  }

  setActiveBot(): boolean {
    return true;
  }

  listBots(): any[] {
    return [{ name: this.name, isOnline: true }];
  }

  createBot(): any | string {
    return 'not_supported_in_test';
  }

  destroyBot(): boolean {
    return true;
  }

  getBot(): any | null {
    return { name: this.name, getPlayer: () => this.player, isOnline: true };
  }

  getBotPlayer(): any | null {
    return this.player;
  }
}

function createContext(player: any, world: WorldAccess): ToolContext {
  return new ToolContextImpl({
    bot: new StaticBotAccess(player, BOT_NAME),
    player: undefined as any,
    world,
  });
}

describe('V6 Tools Integration', () => {
  beforeEach(() => {
    BotManager.init();
    resetMcState();
    vi.restoreAllMocks();
    vi.spyOn(aiEngine, 'moveTo').mockResolvedValue({
      success: true,
      finalPos: { x: 0, y: 64, z: 0 },
      distanceMoved: 0,
      durationMs: 0,
      hungerCost: 0,
      reason: 'success',
    });
  });

  it('eat 工具应自动选择食物并返回恢复结果', async () => {
    const player = createFakePlayer({
      inventoryItems: { 0: createFakeItem('bread', 5) },
      getHunger: vi.fn().mockReturnValueOnce(15).mockReturnValue(20),
    });
    setOnlinePlayers([player]);

    const world = createMutableWorld();
    const ctx = createContext(player, world as unknown as WorldAccess);
    const tool = new EatTool();

    const result = await tool.execute({}, ctx);

    expect(result.success).toBe(true);
    expect(result.data?.item).toBe('bread');
    expect(result.data?.hunger_restored).toBe(5);
    expect(player.simulateUseItem).toHaveBeenCalled();
  });

  it('sleep 工具应在夜晚成功入睡', async () => {
    const player = createFakePlayer({
      pos: { x: 0, y: 64, z: 0, dimid: 0 },
    });
    setOnlinePlayers([player]);

    const world = createMutableWorld({ '2,64,2': 'white_bed' });
    world.getTime = vi.fn(() => 18000);

    const ctx = createContext(player, world as unknown as WorldAccess);
    const tool = new SleepTool();

    const result = await tool.execute({ action: 'sleep' }, ctx);

    expect(result.success).toBe(true);
    expect(result.data?.time_when_wake).toBe(18000);
    expect(player.sleep).toHaveBeenCalled();
  });

  it('use_item 工具应使用指定物品', async () => {
    const player = createFakePlayer({
      inventoryItems: { 0: createFakeItem('ender_pearl', 3) },
    });
    setOnlinePlayers([player]);

    const world = createMutableWorld();
    const ctx = createContext(player, world as unknown as WorldAccess);
    const tool = new UseItemTool();

    const result = await tool.execute(
      { item_name: 'ender_pearl', mode: 'throw', target: { x: 10, y: 64, z: 10 } },
      ctx,
    );

    expect(result.success).toBe(true);
    expect(result.data?.item).toBe('ender_pearl');
    expect(result.data?.mode).toBe('throw');
    expect(player.simulateLookAt).toHaveBeenCalled();
  });

  it('mine_block 工具应挖掘石头方块并更新世界状态', async () => {
    const world = createMutableWorld({ '1,64,1': 'stone' });
    const player = createFakePlayer({
      inventoryItems: { 0: createFakeItem('iron_pickaxe', 1) },
      simulateDestroyBlock: vi.fn((pos: any) => {
        world.setBlock(pos.x, pos.y, pos.z, 'air');
      }),
    });
    setOnlinePlayers([player]);

    const ctx = createContext(player, world as unknown as WorldAccess);
    const tool = new MineBlockTool();

    const result = await tool.execute({ x: 1, y: 64, z: 1 }, ctx);

    expect(result.success).toBe(true);
    expect(result.data?.block).toBe('stone');
    expect(world.blocks['1,64,1']).toBe('air');
    expect(player.simulateDestroyBlock).toHaveBeenCalled();
  });

  it('place_block 工具应放置泥土方块并更新世界状态', async () => {
    const world = createMutableWorld({ '0,64,0': 'stone' });
    const player = createFakePlayer({
      inventoryItems: { 0: createFakeItem('dirt', 10) },
      simulatePlaceBlock: vi.fn((pos: any) => {
        world.setBlock(pos.x, pos.y, pos.z, 'dirt');
      }),
    });
    setOnlinePlayers([player]);

    const ctx = createContext(player, world as unknown as WorldAccess);
    const tool = new PlaceBlockTool();

    const result = await tool.execute({ x: 1, y: 64, z: 0, block_name: 'dirt' }, ctx);

    expect(result.success).toBe(true);
    expect(result.data?.block).toBe('dirt');
    expect(world.blocks['1,64,0']).toBe('dirt');
    expect(player.simulatePlaceBlock).toHaveBeenCalled();
  });

  it('use_block 工具应对方块执行交互', async () => {
    const world = createMutableWorld({ '1,64,1': 'oak_door' });
    const player = createFakePlayer();
    setOnlinePlayers([player]);

    const ctx = createContext(player, world as unknown as WorldAccess);
    const tool = new UseBlockTool();

    const result = await tool.execute({ x: 1, y: 64, z: 1 }, ctx);

    expect(result.success).toBe(true);
    expect(result.data?.block).toBe('oak_door');
    expect(player.simulateInteract).toHaveBeenCalled();
  });

  it('area_operation 工具应支持 break 模式并汇总掉落物', async () => {
    const world = createMutableWorld({
      '0,64,0': 'stone',
      '1,64,0': 'stone',
      '0,64,1': 'stone',
      '1,64,1': 'stone',
    });
    const player = createFakePlayer({
      inventoryItems: { 0: createFakeItem('iron_pickaxe', 1) },
      simulateDestroyBlock: vi.fn((pos: any) => {
        world.setBlock(pos.x, pos.y, pos.z, 'air');
      }),
    });
    setOnlinePlayers([player]);

    const ctx = createContext(player, world as unknown as WorldAccess);
    const tool = new AreaOperationTool();

    const result = await tool.execute(
      {
        mode: 'break',
        from: { x: 0, y: 64, z: 0 },
        to: { x: 1, y: 64, z: 1 },
      },
      ctx,
    );

    expect(result.success).toBe(true);
    expect(result.data?.total_blocks).toBe(4);
    expect(result.data?.success_count).toBe(4);
    expect(result.data?.fail_count).toBe(0);
    expect(result.data?.drops).toBeDefined();
    expect(Object.keys(result.data?.drops ?? {}).length).toBeGreaterThan(0);
    expect(world.blocks['0,64,0']).toBe('air');
  });

  it('area_operation 工具应支持 fill 模式并更新世界状态', async () => {
    const world = createMutableWorld({
      '0,64,0': 'stone',
      '0,64,1': 'stone',
    });
    const player = createFakePlayer({
      inventoryItems: { 0: createFakeItem('oak_planks', 64) },
      simulatePlaceBlock: vi.fn((pos: any) => {
        world.setBlock(pos.x, pos.y, pos.z, 'oak_planks');
      }),
    });
    setOnlinePlayers([player]);

    const ctx = createContext(player, world as unknown as WorldAccess);
    const tool = new AreaOperationTool();

    const result = await tool.execute(
      {
        mode: 'fill',
        from: { x: 1, y: 64, z: 0 },
        to: { x: 2, y: 64, z: 1 },
        block_name: 'oak_planks',
      },
      ctx,
    );

    expect(result.success).toBe(true);
    expect(result.data?.total_blocks).toBe(4);
    expect(result.data?.success_count).toBe(4);
    expect(world.blocks['1,64,0']).toBe('oak_planks');
  });
});
