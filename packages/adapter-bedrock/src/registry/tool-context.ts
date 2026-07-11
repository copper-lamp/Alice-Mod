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

import type { ToolContext, PlayerAccess, WorldAccess, BotAccess, EventNotification } from './tool-module.types.js';
// logger 为 LLSE 全局变量，无需导入

// ── PlayerAccess 实现 ──

export class PlayerAccessImpl implements PlayerAccess {
  getHealth(): number {
    // @ts-ignore — LLSE 全局变量
    const pl = mc.getPlayerList()[0];
    return pl ? pl.health : 0;
  }

  getMaxHealth(): number {
    // @ts-ignore
    const pl = mc.getPlayerList()[0];
    return pl ? pl.maxHealth : 20;
  }

  getHunger(): number {
    // @ts-ignore
    const pl = mc.getPlayerList()[0];
    return pl ? pl.hunger : 20;
  }

  getSaturation(): number {
    return 0; // LLSE 未直接暴露
  }

  getPosition(): { x: number; y: number; z: number; dimension: string } {
    // @ts-ignore
    const pl = mc.getPlayerList()[0];
    if (!pl) return { x: 0, y: 64, z: 0, dimension: '主世界' };
    return {
      x: pl.pos.x,
      y: pl.pos.y,
      z: pl.pos.z,
      dimension: String(pl.pos.dimid),
    };
  }

  getRotation(): { yaw: number; pitch: number } {
    // @ts-ignore
    const pl = mc.getPlayerList()[0];
    if (!pl) return { yaw: 0, pitch: 0 };
    return { yaw: pl.direction.yaw, pitch: pl.direction.pitch };
  }

  getSelectedSlot(): number {
    // @ts-ignore
    const pl = mc.getPlayerList()[0];
    return pl ? pl.selectedSlot : 0;
  }

  getInventory(): any {
    // @ts-ignore
    const pl = mc.getPlayerList()[0];
    return pl ? pl.getInventory() : null;
  }

  getEquipment(): Record<string, any> {
    // @ts-ignore
    const pl = mc.getPlayerList()[0];
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
  getBlock(x: number, y: number, z: number): any {
    // @ts-ignore
    return mc.getBlock(x, y, z, 0);
  }

  getTime(): number {
    // @ts-ignore
    return mc.getTime();
  }

  getWeather(): string {
    // @ts-ignore
    const isRaining = mc.isRaining();
    // @ts-ignore
    const isThunder = mc.isThundering();
    if (isThunder) return 'thunder';
    if (isRaining) return 'rain';
    return 'clear';
  }

  getEntities(options?: any): any[] {
    // @ts-ignore
    return mc.getEntities(options);
  }

  getOnlinePlayers(): any[] {
    // @ts-ignore
    return mc.getPlayerList();
  }
}

// ── BotAccess 占位实现 ──

export class BotAccessImpl implements BotAccess {
  // V10 实现
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
    sendEvent?: (event: EventNotification) => void;
  }) {
    this.player = options.player || new PlayerAccessImpl();
    this.world = options.world || new WorldAccessImpl();
    this.bot = options.bot || new BotAccessImpl();
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