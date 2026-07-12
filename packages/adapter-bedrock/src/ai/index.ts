/**
 * AI 引擎
 *
 * 寻路 + 移动执行 的统一入口。
 */

import type { Vec3, PathOptions, PathContext } from './pathfinding/types.js';
import type { MoveResult, RideResult, DismountResult } from './movement/types.js';
import { pathfindingEngine, PathfindingEngine } from './pathfinding/engine.js';
import { movementExecutor, MovementExecutor } from './movement/executor.js';
import { movementConfig } from './movement/config.js';
import { BotManager } from '../bot/BotManager.js';

export class AIEngine {
  pathfinding: PathfindingEngine;
  movement: MovementExecutor;

  constructor(options: { pathfinding?: PathfindingEngine; movement?: MovementExecutor } = {}) {
    this.pathfinding = options.pathfinding ?? pathfindingEngine;
    this.movement = options.movement ?? movementExecutor;
    movementConfig.loadFromFile();
  }

  /**
   * 移动假人到目标位置
   */
  async moveTo(botName: string | undefined, target: Vec3, options: PathOptions = {}): Promise<MoveResult> {
    const bot = this.resolveBot(botName);
    if (!bot) {
      return {
        success: false,
        finalPos: { x: 0, y: 0, z: 0 },
        distanceMoved: 0,
        durationMs: 0,
        hungerCost: 0,
        reason: 'cancelled',
      };
    }

    const pl = bot.getPlayer();
    if (!pl) {
      return {
        success: false,
        finalPos: { x: 0, y: 0, z: 0 },
        distanceMoved: 0,
        durationMs: 0,
        hungerCost: 0,
        reason: 'cancelled',
      };
    }

    const mergedOptions = movementConfig.merge(options);
    const ctx = this.buildContext(pl, mergedOptions);
    const from = ctx.playerPos;

    const pathResult = await this.pathfinding.findPath(from, target, ctx);
    if (!pathResult.success || !pathResult.path) {
      return {
        success: false,
        finalPos: from,
        distanceMoved: 0,
        durationMs: pathResult.durationMs,
        hungerCost: 0,
        reason: pathResult.reason ?? 'no_path',
      };
    }

    return await this.movement.execute(pathResult.path, ctx);
  }

  /**
   * 骑乘实体
   */
  async ride(botName: string | undefined, entityId: string): Promise<RideResult> {
    const bot = this.resolveBot(botName);
    if (!bot) {
      return { success: false, reason: 'error' };
    }

    const pl = bot.getPlayer();
    if (!pl) {
      return { success: false, reason: 'error' };
    }

    try {
      // @ts-ignore
      const entity = mc.getEntity(entityId);
      if (!entity) {
        return { success: false, reason: 'entity_not_found' };
      }

      const rideableTypes = ['horse', 'donkey', 'mule', 'pig', 'strider', 'boat', 'minecart'];
      const type = String(entity.type || entity.name || '').toLowerCase();
      if (!rideableTypes.some((t) => type.includes(t))) {
        return { success: false, reason: 'not_rideable' };
      }

      const dx = entity.pos.x - pl.pos.x;
      const dy = entity.pos.y - pl.pos.y;
      const dz = entity.pos.z - pl.pos.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist > 3) {
        return { success: false, reason: 'too_far' };
      }

      if (typeof pl.ride === 'function') {
        pl.ride(entity);
      }

      return { success: true, reason: 'success', isRiding: true, mountType: type };
    } catch (e) {
      logger.warn('[AIEngine] ride 失败', e);
      return { success: false, reason: 'error' };
    }
  }

  /**
   * 下马/下船
   */
  async dismount(botName: string | undefined): Promise<DismountResult> {
    const bot = this.resolveBot(botName);
    if (!bot) {
      return { success: false, reason: 'error' };
    }

    const pl = bot.getPlayer();
    if (!pl) {
      return { success: false, reason: 'error' };
    }

    try {
      if (typeof pl.isRiding === 'function' && !pl.isRiding()) {
        return { success: false, reason: 'not_riding' };
      }

      if (typeof pl.dismount === 'function') {
        pl.dismount();
      }

      return { success: true, reason: 'success', isRiding: false };
    } catch (e) {
      logger.warn('[AIEngine] dismount 失败', e);
      return { success: false, reason: 'error' };
    }
  }

  /**
   * 解析假人
   */
  private resolveBot(botName: string | undefined): import('../bot/BotInstance.js').BotInstance | null {
    if (botName) {
      return BotManager.get(botName);
    }

    const online = BotManager.getAll().filter((b) => b.isOnline());
    if (online.length === 1) return online[0];
    if (online.length > 1) {
      logger.warn('[AIEngine] 存在多个在线假人，但未指定 bot_name');
    }
    return online[0] || null;
  }

  /**
   * 构建 PathContext
   */
  private buildContext(player: any, options: Required<import('./pathfinding/types.js').PathOptions>): PathContext {
    const health = typeof player.health === 'number' ? player.health : 20;
    const hunger = typeof player.hunger === 'number' ? player.hunger : 20;
    const dimid = player.pos?.dimid ?? 0;

    const inventory: import('./pathfinding/types.js').ItemSnapshot[] = [];
    try {
      const inv = player.getInventory();
      const size = inv.size ?? 36;
      for (let i = 0; i < size; i++) {
        const item = inv.getItem(i);
        if (!item.isNull()) {
          inventory.push({ name: item.name, count: item.count, slot: i });
        }
      }
    } catch (e) {
      // 忽略背包读取失败
    }

    const hostileEntities: import('./pathfinding/types.js').EntityRef[] = [];
    try {
      // @ts-ignore
      const entities = mc.getEntities();
      for (const e of entities) {
        const type = String(e.type || e.name || '').toLowerCase();
        if (this.isHostile(type)) {
          hostileEntities.push({
            id: String(e.id ?? e.uniqueId ?? ''),
            type,
            pos: { x: e.pos.x, y: e.pos.y, z: e.pos.z },
            isHostile: true,
          });
        }
      }
    } catch (e) {
      // 忽略实体读取失败
    }

    return {
      player,
      playerHealth: health,
      playerHunger: hunger,
      playerPos: { x: player.pos.x, y: player.pos.y, z: player.pos.z },
      playerDimid: dimid,
      inventory,
      dimension: String(dimid),
      hostileEntities,
      options,
    };
  }

  private isHostile(type: string): boolean {
    const hostiles = [
      'zombie', 'skeleton', 'creeper', 'spider', 'enderman', 'witch',
      'slime', 'phantom', 'drowned', 'husk', 'stray', 'evoker', 'vindicator',
      'pillager', 'ravager', 'vex', 'piglin_brute', 'hoglin', 'zoglin',
    ];
    return hostiles.some((h) => type.includes(h));
  }
}

export const aiEngine = new AIEngine();
