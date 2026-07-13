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
    // 兼容直接传入 player 对象的测试/工具场景：如果 botName 不是 BotManager 中已注册假人，
    // 但存在在线玩家同名，则直接使用该玩家对象构造上下文
    const bot = this.resolveBot(botName);
    let pl: any = bot ? bot.getPlayer() : null;

    if (!pl && botName) {
      const online = mc.getOnlinePlayers ? mc.getOnlinePlayers() : [];
      pl = online.find((p: any) => p.name === botName || p.realName === botName) || null;
    }

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

    // 优先使用游戏原生路径接口：SimulatedPlayer 的 simulateMoveTo / simulateNavigateTo
    // 直接让 Bedrock 内部寻路驱动假人，避免自定义 A* 在大范围/复杂地形下的缓慢问题。
    const nativeResult = await this.tryNativeMove(pl, target, mergedOptions);
    if (nativeResult && nativeResult.success) {
      return nativeResult;
    }

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
   * 尝试使用原生 SimulatedPlayer API 直接移动到目标。
   * 成功时返回 MoveResult；不适合原生移动时返回 null，让上层回退到自定义寻路。
   *
   * 实现要点（参考 LLSE FakePlayer 实现）：
   * - simulateNavigateTo 内部使用游戏原生寻路，适合长距离移动；simulateMoveTo 为直线移动兜底。
   * - 每段路径只调用一次原生移动接口，然后等待到达；频繁调用会重置移动状态导致“速度慢”。
   * - 长距离目标拆分为 32 格一段，避免原生接口因目标过远直接失败。
   * - 若 2 秒未移动视为卡住，重新驱动一次；连续卡住则放弃并回退自定义寻路。
   */
  private async tryNativeMove(player: any, target: Vec3, options: Required<PathOptions>): Promise<MoveResult | null> {
    try {
      const hasSimulateNavigateTo = typeof player.simulateNavigateTo === 'function';
      const hasSimulateMoveTo = typeof player.simulateMoveTo === 'function';
      if (!hasSimulateNavigateTo && !hasSimulateMoveTo) {
        return null;
      }

      const start = Date.now();
      const startPos = { x: player.pos.x, y: player.pos.y, z: player.pos.z };
      const dimid = player.pos?.dimid ?? 0;
      const timeout = options.timeout ?? 30000;
      const checkInterval = 100;
      const arrivalDist = 1.5;
      const chunkDistance = 32;
      const stuckMs = 2000;

      const waypoints = this.buildNativeWaypoints(startPos, target, chunkDistance);
      logger.info(`[AIEngine] 原生移动拆分 ${waypoints.length} 段: ${JSON.stringify(waypoints)}`);

      for (let i = 0; i < waypoints.length; i++) {
        const wp = waypoints[i];
        const wpFp = new FloatPos(wp.x, wp.y, wp.z, dimid);
        const segmentStart = Date.now();
        const segmentTimeout = Math.max(5000, Math.floor(timeout / waypoints.length));

        let reached = false;
        let lastPos = { x: player.pos.x, y: player.pos.y, z: player.pos.z };
        let lastMoveTime = Date.now();
        let driveCount = 0;

        while (Date.now() - segmentStart < segmentTimeout) {
          if (Date.now() - start > timeout) break;

          const curr = { x: player.pos.x, y: player.pos.y, z: player.pos.z };
          const dist = this.distance(curr, wp);
          if (dist <= arrivalDist) {
            reached = true;
            break;
          }

          const moved = this.distance(curr, lastPos);
          if (moved >= 0.03) {
            lastPos = curr;
            lastMoveTime = Date.now();
          }

          // 只在启动或卡住时驱动，避免频繁重置移动状态
          const isStuck = Date.now() - lastMoveTime > stuckMs;
          if (driveCount === 0 || isStuck) {
            if (isStuck && driveCount > 0) {
              logger.warn(`[AIEngine] 原生移动第 ${i + 1}/${waypoints.length} 段卡住，重新驱动`);
              if (typeof player.simulateStopMoving === 'function') {
                player.simulateStopMoving();
                await this.sleep(100);
              }
              lastMoveTime = Date.now();
            }
            try {
              if (hasSimulateNavigateTo) {
                player.simulateNavigateTo(wpFp);
              } else {
                player.simulateMoveTo(wpFp);
              }
              driveCount++;
              logger.info(`[AIEngine] 原生移动第 ${i + 1}/${waypoints.length} 段驱动 #${driveCount}`);
            } catch (e) {
              logger.warn(`[AIEngine] 原生移动第 ${i + 1}/${waypoints.length} 段调用异常`, e);
              return null;
            }
          }

          await this.sleep(checkInterval);
        }

        if (!reached) {
          logger.warn(`[AIEngine] 原生移动第 ${i + 1}/${waypoints.length} 段未到达`);
          if (typeof player.simulateStopMoving === 'function') {
            player.simulateStopMoving();
          }
          return null;
        }
      }

      const finalPos = { x: player.pos.x, y: player.pos.y, z: player.pos.z };
      return {
        success: true,
        finalPos,
        distanceMoved: this.distance(startPos, finalPos),
        durationMs: Date.now() - start,
        hungerCost: 0,
        reason: 'success',
      };
    } catch (e) {
      logger.warn('[AIEngine] 原生移动失败', e);
      return null;
    }
  }

  /**
   * 将长距离目标拆分为多个短段，避免原生移动接口因距离过远失败。
   */
  private buildNativeWaypoints(from: Vec3, to: Vec3, maxSegment: number): Vec3[] {
    const totalDist = this.distance(from, to);
    if (totalDist <= maxSegment) {
      return [to];
    }

    const count = Math.ceil(totalDist / maxSegment);
    const waypoints: Vec3[] = [];
    for (let i = 1; i <= count; i++) {
      const t = i / count;
      waypoints.push({
        x: from.x + (to.x - from.x) * t,
        y: from.y + (to.y - from.y) * t,
        z: from.z + (to.z - from.z) * t,
      });
    }
    return waypoints;
  }

  private distance(a: Vec3, b: Vec3): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dz = a.z - b.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
      if (!entityId) {
        return { success: false, reason: 'entity_not_found' };
      }

      // LLSE getEntity 通常要求传入整数/long 类型 ID，尝试转换
      const api = mc as any;
      let entity = null;
      const numericId = Number(entityId);
      if (!Number.isNaN(numericId)) {
        try {
          entity = api.getEntity(numericId);
        } catch (e) {
          // 数字参数失败时回退到字符串
        }
      }
      if (!entity) {
        try {
          entity = api.getEntity(entityId);
        } catch (e) {
          // ignore
        }
      }
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
      } else if (typeof pl.simulateInteract === 'function') {
        pl.simulateInteract();
      }

      return { success: true, reason: 'success', isRiding: true, mountType: type };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      logger.warn(`[AIEngine] ride 失败: ${message}`, e);
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
      const entities = this.safeGetEntities();
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

  /**
   * 安全调用 mc.getEntities，兼容不同 LLSE 版本的参数签名。
   */
  private safeGetEntities(): any[] {
    if (typeof (mc as any).getEntities !== 'function') return [];
    try {
      const res = (mc as any).getEntities();
      if (Array.isArray(res)) return res;
    } catch (e) {
      // ignore
    }
    try {
      const res = (mc as any).getEntities({});
      if (Array.isArray(res)) return res;
    } catch (e) {
      // ignore
    }
    try {
      const res = (mc as any).getEntities({ type: 'boat' });
      if (Array.isArray(res)) return res;
    } catch (e) {
      // ignore
    }
    return [];
  }
}

export const aiEngine = new AIEngine();
