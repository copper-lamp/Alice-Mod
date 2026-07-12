/**
 * V5 工具层集成测试
 *
 * 覆盖 drop_item / equip_item / take_from_container / put_to_container
 * 四个工具的完整执行链路：Tool -> InventoryEngine / ContainerAPI -> Player/World 交互。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import '../setup.js';
import type { ToolContext, BotAccess, WorldAccess } from '../../src/registry/tool-module.types.js';
import { ToolContextImpl } from '../../src/registry/tool-context.js';
import { BotManager } from '../../src/bot/BotManager.js';
import { aiEngine } from '../../src/ai/index.js';
import { resetMcState, setOnlinePlayers } from '../setup.js';

import DropItemTool from '../../src/tools/inventory/drop-item/index.js';
import EquipItemTool from '../../src/tools/inventory/equip-item/index.js';
import TakeFromContainerTool from '../../src/tools/inventory/take-from-container/index.js';
import PutToContainerTool from '../../src/tools/inventory/put-to-container/index.js';

const BOT_NAME = 'TestBot';

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
    refreshItems: vi.fn(),
    getNbt: () => new (globalThis as any).NbtCompound(),
    setNbt: vi.fn(() => true),
    ...overrides,
  };
}

function createMutableWorld(initialBlocks: Record<string, string> = {}) {
  const blocks: Record<string, string> = { ...initialBlocks };
  const containers: Record<string, any> = {};

  return {
    blocks,
    containers,
    getBlock: vi.fn((x: number, y: number, z: number) => {
      const key = `${x},${y},${z}`;
      const name = blocks[key] ?? 'air';
      return {
        name,
        pos: { x, y, z, dimid: 0 },
        getPos: () => ({ x, y, z, dimid: 0 }),
        getContainer: () => containers[key] ?? null,
      };
    }),
    setBlock: (x: number, y: number, z: number, name: string) => {
      blocks[`${x},${y},${z}`] = name;
    },
    setContainer: (x: number, y: number, z: number, container: any) => {
      containers[`${x},${y},${z}`] = container;
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

describe('V5 Tools Integration', () => {
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

  it('drop_item 工具应丢弃指定物品并返回数量', async () => {
    const player = createFakePlayer({
      inventoryItems: { 1: createFakeItem('cobblestone', 32) },
    });
    setOnlinePlayers([player]);

    const world = createMutableWorld();
    const ctx = createContext(player, world as unknown as WorldAccess);
    const tool = new DropItemTool();

    const result = await tool.execute({ item_name: 'cobblestone', count: 10 }, ctx);

    expect(result.success).toBe(true);
    expect(result.data?.item).toBe('cobblestone');
    expect(result.data?.dropped).toBe(10);
    expect(result.data?.remaining).toBe(22);
  });

  it('equip_item 工具应将物品装备到指定部位', async () => {
    const player = createFakePlayer({
      inventoryItems: { 0: createFakeItem('iron_helmet', 1) },
    });
    setOnlinePlayers([player]);

    const world = createMutableWorld();
    const ctx = createContext(player, world as unknown as WorldAccess);
    const tool = new EquipItemTool();

    const result = await tool.execute({ item_name: 'iron_helmet', slot: 'head' }, ctx);

    expect(result.success).toBe(true);
    expect(result.data?.item).toBe('iron_helmet');
    expect(result.data?.slot).toBe('head');
  });

  it('take_from_container 工具应从容器取出物品到背包', async () => {
    const container = createFakeContainer(27, { 0: createFakeItem('oak_planks', 16) });
    const world = createMutableWorld({ '1,64,1': 'chest' });
    world.setContainer(1, 64, 1, container);

    const player = createFakePlayer();
    setOnlinePlayers([player]);

    const ctx = createContext(player, world as unknown as WorldAccess);
    const tool = new TakeFromContainerTool();

    const result = await tool.execute(
      { container_position: { x: 1, y: 64, z: 1 }, item_name: 'oak_planks', count: 8 },
      ctx,
    );

    expect(result.success).toBe(true);
    expect(result.data?.item).toBe('oak_planks');
    expect(result.data?.transferred).toBe(8);
    expect(container.getItem(0).count).toBe(8);
    expect(player.getInventory().getItem(0).count).toBe(8);
  });

  it('put_to_container 工具应将背包物品放入容器', async () => {
    const container = createFakeContainer(27);
    const world = createMutableWorld({ '1,64,1': 'chest' });
    world.setContainer(1, 64, 1, container);

    const player = createFakePlayer({
      inventoryItems: { 0: createFakeItem('oak_planks', 32) },
    });
    setOnlinePlayers([player]);

    const ctx = createContext(player, world as unknown as WorldAccess);
    const tool = new PutToContainerTool();

    const result = await tool.execute(
      { container_position: { x: 1, y: 64, z: 1 }, item_name: 'oak_planks', count: 16 },
      ctx,
    );

    expect(result.success).toBe(true);
    expect(result.data?.item).toBe('oak_planks');
    expect(result.data?.transferred).toBe(16);
    expect(player.getInventory().getItem(0).count).toBe(16);
    expect(container.getItem(0).count).toBe(16);
  });
});
