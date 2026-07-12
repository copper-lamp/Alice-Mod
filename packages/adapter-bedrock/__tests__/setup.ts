/**
 * 测试全局 mock — 模拟 LLSE 运行时环境
 */

import { vi } from 'vitest';

// ── 日志 ──

(globalThis as any).logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  setTitle: vi.fn(),
};

// ── 文件系统 ──

const fileStore: Record<string, string> = {};
const dirStore: Set<string> = new Set();

(globalThis as any).File = {
  exists: vi.fn((path: string) => path in fileStore || dirStore.has(path)),
  mkdir: vi.fn((path: string) => { dirStore.add(path); return true; }),
  readFrom: vi.fn((path: string) => fileStore[path] || ''),
  writeTo: vi.fn((path: string, data: string) => {
    fileStore[path] = data;
    const lastSep = path.lastIndexOf('/');
    if (lastSep > 0) {
      dirStore.add(path.substring(0, lastSep + 1));
    }
    return true;
  }),
  deleteFile: vi.fn((path: string) => { delete fileStore[path]; return true; }),
  getFilesList: vi.fn(() => Object.keys(fileStore).map((p) => {
    const sep = p.lastIndexOf('/');
    return sep >= 0 ? p.substring(sep + 1) : p;
  })),
  checkIsDir: vi.fn((path: string) => dirStore.has(path)),
};

export function resetFileStore(): void {
  for (const key of Object.keys(fileStore)) delete fileStore[key];
  dirStore.clear();
}

// ── NBT ──

class FakeNbtCompound {
  private tags: Record<string, any> = {};

  setTag(key: string, value: any): void {
    this.tags[key] = value;
  }

  getTag(key: string): any {
    return this.tags[key];
  }

  removeTag(key: string): this {
    delete this.tags[key];
    return this;
  }

  destroy(): void {
    this.tags = {};
  }

  toSNBT(): string {
    return JSON.stringify(this.tags);
  }
}

(globalThis as any).NbtCompound = FakeNbtCompound;
(globalThis as any).NBT = {
  parseSNBT: vi.fn((snbt: string) => {
    try {
      const compound = new FakeNbtCompound();
      compound.setTag('parsed', JSON.parse(snbt));
      return compound;
    } catch {
      return null;
    }
  }),
};

// ── 坐标 ──

(globalThis as any).FloatPos = class FloatPos {
  constructor(
    public x: number,
    public y: number,
    public z: number,
    public dimid: number,
  ) {}
};

// ── 玩家模拟 ──

export function createFakePlayer(overrides: Partial<any> = {}): any {
  const inventoryItems: any[] = [];
  const armorItems: any[] = [];

  return {
    realName: overrides.realName ?? 'TestBot',
    name: overrides.name ?? 'TestBot',
    pos: overrides.pos ?? { x: 0, y: 64, z: 0, dimid: 0 },
    direction: overrides.direction ?? { yaw: 0, pitch: 0 },
    gameMode: overrides.gameMode ?? 5,
    health: overrides.health ?? 20,
    maxHealth: overrides.maxHealth ?? 20,
    hunger: overrides.hunger ?? 20,
    saturation: overrides.saturation ?? 0,
    isSimulatedPlayer: vi.fn(() => overrides.isSimulated ?? true),
    teleport: vi.fn(() => true),
    simulateDisconnect: vi.fn(() => true),
    simulateNavigateTo: vi.fn(() => ({ isFullPath: true, path: [[0, 64, 0]] })),
    simulateSetBodyRotation: vi.fn(),
    simulateMoveTo: vi.fn(),
    simulateStopMoving: vi.fn(),
    simulateAttack: vi.fn(),
    simulateDestroy: vi.fn(),
    simulateStopDestroyingBlock: vi.fn(),
    simulateInteract: vi.fn(),
    simulateStopInteracting: vi.fn(),
    simulateUseItem: vi.fn(),
    simulateStopUsingItem: vi.fn(),
    simulateLookAt: vi.fn(),
    setGameMode: vi.fn(),
    getHealth: vi.fn(() => overrides.health ?? 20),
    getMaxHealth: vi.fn(() => overrides.maxHealth ?? 20),
    getHunger: vi.fn(() => overrides.hunger ?? 20),
    getSaturation: vi.fn(() => overrides.saturation ?? 0),
    getAir: vi.fn(() => overrides.air ?? 300),
    getHand: vi.fn(() => overrides.hand ?? { isNull: () => true, name: '', count: 0 }),
    getOffHand: vi.fn(() => overrides.offHand ?? { isNull: () => true, name: '', count: 0 }),
    getInventory: vi.fn(() => ({
      size: 36,
      getAllItems: () => inventoryItems,
      getItem: (i: number) => inventoryItems[i] ?? { isNull: () => true, name: '', count: 0 },
      hasRoomFor: () => true,
      addItem: vi.fn((item: any) => { inventoryItems.push(item); return true; }),
      removeItem: vi.fn(() => true),
    })),
    getArmor: vi.fn(() => ({
      getAllItems: () => armorItems,
      getItem: (i: number) => armorItems[i] ?? { isNull: () => true, name: '', count: 0 },
    })),
    getNbt: vi.fn(() => new FakeNbtCompound()),
    setNbt: vi.fn(() => true),
    selectedSlot: overrides.selectedSlot ?? 0,
    refreshItems: vi.fn(),
    getEntityFromViewVector: vi.fn(() => null),
    getBlockFromViewVector: vi.fn(() => null),
    ...overrides,
  };
}

// ── mc 全局 ──

let onlinePlayers: any[] = [];
let spawnedPlayers: any[] = [];
let listeners: Record<string, any[]> = {};

export function setOnlinePlayers(players: any[]): void {
  onlinePlayers = players;
}

export function getSpawnedPlayers(): any[] {
  return spawnedPlayers;
}

export function resetMcState(): void {
  onlinePlayers = [];
  spawnedPlayers = [];
  listeners = {};
}

export function triggerEvent(event: string, ...args: any[]): void {
  for (const cb of listeners[event] || []) {
    cb(...args);
  }
}

(globalThis as any).mc = {
  getPlayer: vi.fn((name: string) => onlinePlayers.find((p) => p.realName === name || p.name === name) || null),
  getOnlinePlayers: vi.fn(() => onlinePlayers),
  spawnSimulatedPlayer: vi.fn((name: string, pos: any) => {
    const player = createFakePlayer({ realName: name, name, pos });
    spawnedPlayers.push(player);
    onlinePlayers.push(player);
    return player;
  }),
  spawnItem: vi.fn(() => true),
  broadcast: vi.fn(),
  listen: vi.fn((event: string, cb: any) => {
    if (!listeners[event]) listeners[event] = [];
    listeners[event].push(cb);
  }),
  getBlock: vi.fn(() => ({ name: 'stone' })),
  getTime: vi.fn(() => 0),
  isRaining: vi.fn(() => false),
  isThundering: vi.fn(() => false),
  getEntities: vi.fn(() => []),
  newCommand: vi.fn(() => ({
    setEnum: vi.fn(),
    mandatory: vi.fn(),
    overload: vi.fn(),
    setCallback: vi.fn(function (cb: any) { this.callback = cb; }),
    setup: vi.fn(() => true),
  })),
};

// ── ll ──

(globalThis as any).ll = {
  registerPlugin: vi.fn(),
};
