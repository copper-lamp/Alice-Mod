/**
 * ToolContextImpl — 工具执行上下文实现
 *
 * 提供 IToolModule 执行所需的上下文环境，包括：
 * - 玩家操作 API（PlayerAccess）
 * - 世界操作 API（WorldAccess）
 * - 假人管理 API（BotAccess，占位）
 * - 事件通知发送
 * - 日志记录
 * - 耗时统计
 */

import type { ToolContext, PlayerAccess, WorldAccess, BotAccess, BotConfig, EventNotification } from './tool-module.types.js';
import { BotManager } from '../bot/BotManager.js';
import { SUCCESS } from '../utils/constants.js';
// logger 为 LLSE 全局变量，无需导入

// ── PlayerAccess 实现 ──

export class PlayerAccessImpl implements PlayerAccess {
  private getPlayerFn: () => Player | null;

  constructor(getPlayerFn?: () => Player | null) {
    this.getPlayerFn = getPlayerFn || (() => {
      return mc.getOnlinePlayers()[0] ?? null;
    });
  }

  private getPlayer(): Player | null {
    return this.getPlayerFn();
  }

  getHealth(): number {
    const pl = this.getPlayer();
    return pl ? pl.health : 0;
  }

  getMaxHealth(): number {
    const pl = this.getPlayer();
    return pl ? pl.maxHealth : 20;
  }

  getHunger(): number {
    const pl = this.getPlayer();
    return pl ? pl.hunger : 20;
  }

  getSaturation(): number {
    const pl = this.getPlayer();
    return pl ? pl.saturation : 0;
  }

  getPosition(): { x: number; y: number; z: number; dimension: string } {
    const pl = this.getPlayer();
    if (!pl) return { x: 0, y: 64, z: 0, dimension: '主世界' };
    return {
      x: pl.pos.x,
      y: pl.pos.y,
      z: pl.pos.z,
      dimension: String(pl.pos.dimid),
    };
  }

  getRotation(): { yaw: number; pitch: number } {
    const pl = this.getPlayer();
    if (!pl) return { yaw: 0, pitch: 0 };
    return { yaw: pl.direction.yaw, pitch: pl.direction.pitch };
  }

  getSelectedSlot(): number {
    const pl = this.getPlayer();
    return pl ? pl.selectedSlot : 0;
  }

  setSelectedSlot(slot: number): boolean {
    const pl = this.getPlayer();
    if (!pl) return false;
    try {
      if (typeof pl.setSelectedSlot === 'function') {
        pl.setSelectedSlot(slot);
        return true;
      }
      pl.selectedSlot = slot;
      return (pl.selectedSlot ?? 0) === slot;
    } catch (e) {
      return false;
    }
  }

  getInventory(): Container | null {
    const pl = this.getPlayer();
    return pl ? pl.getInventory() : null;
  }

  getEquipment(): Record<string, string | null> {
    const pl = this.getPlayer();
    if (!pl) return {};
    return {
      hand: pl.getHand()?.name || null,
      offhand: pl.getOffHand()?.name || null,
      helmet: pl.getArmor().getItem(0)?.name || null,
      chestplate: pl.getArmor().getItem(1)?.name || null,
      leggings: pl.getArmor().getItem(2)?.name || null,
      boots: pl.getArmor().getItem(3)?.name || null,
    };
  }
}

// ── WorldAccess 实现 ──

export class WorldAccessImpl implements WorldAccess {
  getBlock(x: number, y: number, z: number): Block | null {
    return mc.getBlock(x, y, z, 0);
  }

  getTime(): number {
    return mc.getTime();
  }

  getWeather(): string {
    const isRaining = mc.isRaining();
    const isThunder = mc.isThundering();
    if (isThunder) return 'thunder';
    if (isRaining) return 'rain';
    return 'clear';
  }

  getEntities(options?: Record<string, unknown>): Entity[] {
    // @ts-expect-error — LLSE mc 类型声明中无 getEntities，但运行时可用
    return mc.getEntities(options);
  }

  getOnlinePlayers(): Player[] {
    return mc.getOnlinePlayers();
  }
}

// ── BotAccess 实现 ──

export class BotAccessImpl implements BotAccess {
  private activeBotName: string | null = null;

  getActiveBot(): BotHandle | null {
    if (!this.activeBotName) return null;
    return BotManager.get(this.activeBotName) as unknown as BotHandle | null;
  }

  setActiveBot(name: string): boolean {
    const bot = BotManager.get(name);
    if (!bot) return false;
    this.activeBotName = name;
    return true;
  }

  listBots(): BotHandle[] {
    return BotManager.getAll().map((b) => b as unknown as BotHandle);
  }

  createBot(config: BotConfig): BotHandle | string {
    const result = BotManager.create(config.name, config.pos, config.owner) as string;
    if (result !== SUCCESS) return result;
    return BotManager.get(config.name)! as unknown as BotHandle;
  }

  destroyBot(name: string): boolean {
    const result = BotManager.remove(name);
    return result === SUCCESS;
  }

  getBot(name: string): BotHandle | null {
    return BotManager.get(name) as unknown as BotHandle | null;
  }

  getBotPlayer(name: string): Player | null {
    const bot = BotManager.get(name);
    return bot ? (bot.getPlayer() as Player) : null;
  }
}

// 内部使用的假人手柄最小类型
interface BotHandle {
  name: string;
  isOnline: boolean | (() => boolean);
  getPlayer?: () => Player;
  getInfo?: () => Record<string, unknown>;
}

// ── ToolContext 实现 ──

export class ToolContextImpl implements ToolContext {
  readonly player: PlayerAccess;
  readonly world: WorldAccess;
  readonly bot: BotAccess;
  readonly logger = logger;
  private startTime: number;
  private sendEventFn: (event: EventNotification) => void;

  constructor(options: {
    player?: PlayerAccess;
    world?: WorldAccess;
    bot?: BotAccess;
    activeBotName?: string;
    sendEvent?: (event: EventNotification) => void;
  }) {
    this.bot = options.bot || new BotAccessImpl();
    if (options.activeBotName) {
      this.bot.setActiveBot(options.activeBotName);
    }
    this.player = options.player || new PlayerAccessImpl(() => {
      const activeBot = this.bot.getActiveBot();
      if (activeBot && typeof activeBot.getPlayer === 'function') return activeBot.getPlayer();
      return mc.getOnlinePlayers()[0] ?? null;
    });
    this.world = options.world || new WorldAccessImpl();
    this.sendEventFn = options.sendEvent || (() => {});
    this.startTime = Date.now();
  }

  sendEvent(event: EventNotification): void {
    this.sendEventFn(event);
  }

  getElapsedMs(): number {
    return Date.now() - this.startTime;
  }
}
