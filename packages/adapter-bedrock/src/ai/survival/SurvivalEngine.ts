/**
 * 生存操作引擎
 *
 * 封装 eat / sleep / use_item 三种生存操作的核心逻辑。
 */

import type { InventoryEngine } from '../inventory/index.js';
import type { WorldAccess } from '../../registry/tool-module.types.js';
import type { Vec3 } from '../pathfinding/types.js';
import { aiEngine } from '../index.js';
import { BotManager } from '../../bot/BotManager.js';
import { configManager } from '../../config/index.js';
import { waitFor } from '../../utils/helpers.js';
import { FoodSelector, getFoodInfo, isFood } from './FoodSelector.js';
import { normalizeName } from '../inventory/InventoryEngine.js';
import { BedFinder, isBed } from './BedFinder.js';
import { ItemUser } from './ItemUser.js';
import type { EatResult, SleepResult, UseItemResult } from './types.js';

export interface SurvivalEngineOptions {
  player: any;
  botName: string;
  inventoryEngine: InventoryEngine;
  world: WorldAccess;
}

export class SurvivalEngine {
  private player: any;
  private botName: string;
  private inventoryEngine: InventoryEngine;
  private world: WorldAccess;
  private foodSelector: FoodSelector;
  private bedFinder: BedFinder;
  private itemUser: ItemUser;

  constructor(options: SurvivalEngineOptions) {
    this.player = options.player;
    this.botName = options.botName;
    this.inventoryEngine = options.inventoryEngine;
    this.world = options.world;
    this.foodSelector = new FoodSelector();
    this.bedFinder = new BedFinder(options.world);
    this.itemUser = new ItemUser(options.player, options.inventoryEngine);
  }

  /**
   * 吃东西
   */
  async eat(foodName?: string): Promise<EatResult> {
    const start = Date.now();
    const inventory = this.inventoryEngine.list();

    let targetSlot: import('../inventory/types.js').ItemStack | null = null;
    let foodInfo = null;

    if (foodName) {
      const found = this.inventoryEngine.find(foodName);
      if (!found) {
        return { success: false, error: 'NO_FOOD', durationMs: Date.now() - start };
      }
      const itemId = normalizeName(found.item.type || found.item.name);
      if (!isFood(itemId)) {
        return { success: false, error: 'CANNOT_EAT', durationMs: Date.now() - start };
      }
      targetSlot = {
        name: itemId,
        count: found.item.count,
        slot: found.slot,
        source: found.source,
      };
      foodInfo = getFoodInfo(itemId)!;
    } else {
      const best = this.foodSelector.selectBest(inventory);
      if (!best) {
        return { success: false, error: 'NO_FOOD', durationMs: Date.now() - start };
      }
      targetSlot = best.slot;
      foodInfo = best.food;
    }

    if (!targetSlot || !foodInfo) {
      return { success: false, error: 'NO_FOOD', durationMs: Date.now() - start };
    }

    this.inventoryEngine.selectSlot(targetSlot.slot);

    const startHunger = this.safeGetHunger();
    const startSaturation = this.safeGetSaturation();

    try {
      this.player.simulateUseItem();
      await waitFor(() => this.isEatingDone(startHunger, startSaturation), 10000, 200);
    } catch (e) {
      // 忽略食用等待异常，继续返回结果
    }

    BotManager.saveInventory(this.botName);

    const endHunger = this.safeGetHunger();
    const endSaturation = this.safeGetSaturation();

    return {
      success: true,
      item: targetSlot.name,
      hungerRestored: endHunger - startHunger,
      saturationRestored: endSaturation - startSaturation,
      effects: [],
      durationMs: Date.now() - start,
    };
  }

  /**
   * 睡觉或起床
   */
  async sleep(action: 'sleep' | 'wake', bedPos?: Vec3, maxWaitMs?: number): Promise<SleepResult> {
    if (action === 'wake') {
      try {
        if (typeof this.player.wake === 'function') {
          this.player.wake();
        }
      } catch (e) {
        // 忽略 wake 异常
      }
      return { success: true, sleptDuration: 0 };
    }

    const cfg = configManager.survival.sleep;
    const waitTime = maxWaitMs ?? cfg.max_wait_ms;

    // 确保当前是夜晚或雷暴，否则通过命令设为夜晚
    await this.ensureNightTime();

    let bed = bedPos
      ? { pos: bedPos, block: this.world.getBlock(bedPos.x, bedPos.y, bedPos.z) }
      : this.bedFinder.findNearest(this.getPlayerPosition(), cfg.max_bed_search_radius);

    // 若 ctx.world 未正确提供，回退到 mc.getBlock
    if (bedPos && (!bed || !bed.block || !isBed(bed.block.name))) {
      try {
        const fallbackBlock = mc.getBlock(bedPos.x, bedPos.y, bedPos.z, this.player.pos?.dimid ?? 0);
        if (fallbackBlock && isBed(fallbackBlock.name)) {
          bed = { pos: bedPos, block: fallbackBlock };
        }
      } catch (e) {
        // ignore
      }
    }

    if (!bed || !bed.block || !isBed(bed.block.type || bed.block.name)) {
      return { success: false, error: 'NO_BED' };
    }

    // 寻路到床的邻接位置，不要站在床方块内部
    const standPos = this.findBedStandPosition(bed.pos);
    const moveResult = await aiEngine.moveTo(this.botName, standPos);
    if (!moveResult.success) {
      return { success: false, error: moveResult.reason || 'MOVE_FAILED', sleptDuration: 0 };
    }

    // 再向床靠近一格，确保在交互范围内（< 1.5 格）
    const closePos = this.findClosestNeighbor(bed.pos);
    if (closePos) {
      const closeMove = await aiEngine.moveTo(this.botName, closePos);
      if (!closeMove.success) {
        logger.warn('[SurvivalEngine] 无法继续靠近床，仍尝试当前位置交互');
      }
    }

    // 重新检查入睡条件（移动到床旁边后再检查）
    const check = this.bedFinder.checkSleepConditions(bed.pos, this.player);
    if (!check.ok) {
      // 若仅因为时间不对，已尝试强制设置；其他原因（怪物、床不可用）再返回
      if (check.reason !== 'NOT_SLEEP_TIME') {
        return { success: false, error: check.reason, sleptDuration: 0 };
      }
    }

    const sleepStart = Date.now();
    let sleepInitiated = false;
    const dimid = this.player.pos?.dimid ?? 0;

    // 清空主手，避免手持工具/食物影响床的交互
    this.clearMainHand();

    // 看向床的顶面中心，这是玩家通常点击的位置
    const bedLookAt = new FloatPos(bed.pos.x + 0.5, bed.pos.y + 0.6, bed.pos.z + 0.5, dimid);
    this.simulateLookAt(bedLookAt);
    await this._sleep(300);

    // 尝试直接调用 sleep（部分 LLSE 版本可能支持）
    try {
      if (typeof this.player.sleep === 'function') {
        this.player.sleep(bed.block);
        await this._sleep(400);
        sleepInitiated = this.isSleeping();
        if (sleepInitiated) logger.info('[SurvivalEngine] player.sleep 成功');
      }
    } catch (e) {
      // ignore
    }

    // 使用交互 API 点击床：Bedrock 中 sleep 本质是玩家对床方块执行交互（右键）。
    // 主手必须为空，且视角要对准床，否则可能触发手持物品的使用。
    const bedFp = new FloatPos(bed.pos.x + 0.5, bed.pos.y + 0.5, bed.pos.z + 0.5, dimid);
    if (!sleepInitiated) {
      // 0. simulateUseItemOnBlock(targetPos, clickBlockPos) 最直接地对床方块右键
      if (typeof this.player.simulateUseItemOnBlock === 'function') {
        for (let attempt = 0; attempt < 12 && !sleepInitiated; attempt++) {
          try {
            this.clearMainHand();
            this.simulateLookAt(bedLookAt);
            this.player.simulateUseItemOnBlock(bedFp, bedFp);
            await this._sleep(350);
            sleepInitiated = this.isSleeping();
            if (sleepInitiated) {
              logger.info('[SurvivalEngine] simulateUseItemOnBlock 成功入睡');
              break;
            }
          } catch (e) {
            // ignore
          }
        }
      }

      // 1. simulateUseItem（空手右键）最贴近玩家上床动作
      if (!sleepInitiated && typeof this.player.simulateUseItem === 'function') {
        for (let attempt = 0; attempt < 16 && !sleepInitiated; attempt++) {
          try {
            this.clearMainHand();
            this.simulateLookAt(bedLookAt);
            this.player.simulateUseItem();
            await this._sleep(350);
            sleepInitiated = this.isSleeping();
            if (sleepInitiated) {
              logger.info('[SurvivalEngine] simulateUseItem 成功入睡');
              break;
            }
          } catch (e) {
            // ignore
          }
        }
      }

      // 2. simulateInteract 作为兜底
      if (!sleepInitiated && typeof this.player.simulateInteract === 'function') {
        for (let attempt = 0; attempt < 12 && !sleepInitiated; attempt++) {
          try {
            this.clearMainHand();
            this.simulateLookAt(bedLookAt);
            this.player.simulateInteract();
            await this._sleep(350);
            sleepInitiated = this.isSleeping();
            if (sleepInitiated) {
              logger.info('[SurvivalEngine] simulateInteract 成功入睡');
              break;
            }
          } catch (e) {
            // ignore
          }
        }
      }
    }

    // 若仍然无法入睡，使用时间跳跃作为最后兜底（不是真正睡觉，但保证生存循环可继续）
    if (!sleepInitiated) {
      logger.warn('[SurvivalEngine] 模拟入睡未生效，尝试命令设置时间为白天');
      if (this.runServerCommand('time set day')) {
        return {
          success: true,
          sleptDuration: 0,
          timeWhenWake: this.safeGetTime(),
        };
      }
      return { success: false, error: 'SLEEP_FAILED' };
    }

    await waitFor(() => !this.isSleeping() || this.isDayTime(), waitTime, 500);

    if (this.isSleeping()) {
      try {
        if (typeof this.player.wake === 'function') {
          this.player.wake();
        }
      } catch (e) {
        // 忽略 wake 异常
      }
    }

    const timeWhenWake = this.safeGetTime();
    BotManager.saveInventory(this.botName);

    return {
      success: true,
      sleptDuration: Date.now() - sleepStart,
      timeWhenWake,
    };
  }

  /**
   * 使用物品
   */
  async useItem(itemName: string, mode: 'use' | 'drink' | 'throw', target?: Vec3): Promise<UseItemResult> {
    return this.itemUser.useItem(itemName, mode, target);
  }

  // ── 私有辅助 ──

  private getPlayerPosition(): Vec3 {
    return {
      x: this.player.pos?.x ?? 0,
      y: this.player.pos?.y ?? 0,
      z: this.player.pos?.z ?? 0,
    };
  }

  private safeGetHunger(): number {
    try {
      return typeof this.player.getHunger === 'function' ? this.player.getHunger() : 20;
    } catch (e) {
      return 20;
    }
  }

  private safeGetSaturation(): number {
    try {
      return typeof this.player.getSaturation === 'function' ? this.player.getSaturation() : 0;
    } catch (e) {
      return 0;
    }
  }

  private safeGetTime(): number {
    try {
      return this.world.getTime();
    } catch (e) {
      return 0;
    }
  }

  private safeGetWeather(): string {
    try {
      return this.world.getWeather();
    } catch (e) {
      return 'clear';
    }
  }

  private isEatingDone(startHunger: number, startSaturation: number): boolean {
    try {
      const hunger = this.safeGetHunger();
      const saturation = this.safeGetSaturation();
      return hunger > startHunger || saturation > startSaturation;
    } catch (e) {
      return false;
    }
  }

  private isSleeping(): boolean {
    try {
      return typeof this.player.isSleeping === 'function' && this.player.isSleeping();
    } catch (e) {
      return false;
    }
  }

  private isDayTime(): boolean {
    try {
      const time = this.safeGetTime();
      return time > 23458 || time < 12541;
    } catch (e) {
      return false;
    }
  }

  /**
   * 找到床旁边可以站立的邻接位置（要求脚下有实体方块、自身是空气）。
   */
  private findBedStandPosition(bedPos: Vec3): Vec3 {
    const candidates = [
      { x: bedPos.x + 1, y: bedPos.y, z: bedPos.z },
      { x: bedPos.x - 1, y: bedPos.y, z: bedPos.z },
      { x: bedPos.x, y: bedPos.y, z: bedPos.z + 1 },
      { x: bedPos.x, y: bedPos.y, z: bedPos.z - 1 },
    ];

    for (const c of candidates) {
      try {
        const standBlock = this.world.getBlock(c.x, c.y, c.z);
        const groundBlock = this.world.getBlock(c.x, c.y - 1, c.z);
        const standType = standBlock ? String(standBlock.type || standBlock.name).toLowerCase() : 'air';
        const groundType = groundBlock ? String(groundBlock.type || groundBlock.name).toLowerCase() : 'air';
        if (standType === 'air' && groundType !== 'air' && groundType !== 'cave_air' && groundType !== 'void_air') {
          return { x: c.x, y: c.y, z: c.z };
        }
      } catch (e) {
        // ignore
      }
    }

    // 兜底：站在床头/床脚正上方（部分床允许这样入睡）
    return { x: bedPos.x, y: bedPos.y, z: bedPos.z };
  }

  /**
   * 找到离床最近的邻接空气位置，用于靠近床进行交互。
   */
  private findClosestNeighbor(bedPos: Vec3): Vec3 | null {
    const candidates = [
      { x: bedPos.x + 1, y: bedPos.y, z: bedPos.z },
      { x: bedPos.x - 1, y: bedPos.y, z: bedPos.z },
      { x: bedPos.x, y: bedPos.y, z: bedPos.z + 1 },
      { x: bedPos.x, y: bedPos.y, z: bedPos.z - 1 },
    ];

    let best: Vec3 | null = null;
    let bestDist = Infinity;
    for (const c of candidates) {
      try {
        const standBlock = this.world.getBlock(c.x, c.y, c.z);
        const groundBlock = this.world.getBlock(c.x, c.y - 1, c.z);
        const standType = standBlock ? String(standBlock.type || standBlock.name).toLowerCase() : 'air';
        const groundType = groundBlock ? String(groundBlock.type || groundBlock.name).toLowerCase() : 'air';
        if (standType === 'air' && groundType !== 'air' && groundType !== 'cave_air' && groundType !== 'void_air') {
          const dist = Math.sqrt(
            Math.pow(c.x - this.player.pos.x, 2) +
            Math.pow(c.y - this.player.pos.y, 2) +
            Math.pow(c.z - this.player.pos.z, 2),
          );
          if (dist < bestDist) {
            bestDist = dist;
            best = c;
          }
        }
      } catch (e) {
        // ignore
      }
    }
    return best;
  }

  /**
   * 若不是夜晚/雷暴，通过命令强制设置为夜晚。
   */
  private async ensureNightTime(): Promise<void> {
    try {
      const time = this.safeGetTime();
      const weather = this.safeGetWeather();
      const isNight = time >= 12541 && time <= 23458;
      const isThunder = weather === 'thunder';
      if (!isNight && !isThunder) {
        logger.info('[SurvivalEngine] 当前不是夜晚，使用命令设置为夜晚');
        this.runServerCommand('time set 13000');
        await this._sleep(200);
      }
    } catch (e) {
      // ignore
    }
  }

  /**
   * 以玩家上下文优先执行服务器命令。
   */
  private runServerCommand(cmd: string): boolean {
    try {
      if (typeof this.player.runCmd === 'function') {
        const ok = this.player.runCmd(cmd);
        if (ok) return true;
      }
    } catch (e) {
      // ignore
    }

    try {
      const api = mc as any;
      if (typeof api.runCmd === 'function') {
        return api.runCmd(cmd);
      }
      if (typeof api.runcmdEx === 'function') {
        const res = api.runcmdEx(cmd);
        return res?.success ?? false;
      }
      if (typeof api.runcmd === 'function') {
        api.runcmd(cmd);
        return true;
      }
    } catch (e) {
      // ignore
    }
    return false;
  }

  private _sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 让玩家看向指定位置（兼容不同 LLSE 版本）。
   */
  private simulateLookAt(target: FloatPos): void {
    try {
      if (typeof this.player.simulateLookAt === 'function') {
        this.player.simulateLookAt(target);
      } else if (typeof this.player.lookAt === 'function') {
        this.player.lookAt(target);
      }
    } catch (e) {
      // ignore
    }
  }

  /**
   * 清空主手，避免手持物品干扰床等方块交互。
   */
  private clearMainHand(): void {
    try {
      // 1. 尝试切换到快捷栏中的空槽位
      const inv = this.player.getInventory();
      const size = inv?.size ?? 36;
      let emptySlot = -1;
      for (let i = 0; i < Math.min(size, 9); i++) {
        const item = inv.getItem(i);
        if (!item || item.isNull()) {
          emptySlot = i;
          break;
        }
      }
      if (emptySlot >= 0 && typeof this.player.setSelectedSlot === 'function') {
        const ok = this.player.setSelectedSlot(emptySlot);
        if (ok && this.player.selectedSlot === emptySlot) {
          return;
        }
      }

      // 2. 使用命令将主手替换为空气
      const api = mc as any;
      const selector = `"${this.player.realName}"`;
      const cmds = [
        `item replace entity ${selector} weapon.mainhand with air 1`,
        `replaceitem entity ${selector} slot.weapon.mainhand air 1 0`,
      ];
      for (const cmd of cmds) {
        let ok = false;
        if (typeof this.player.runCmd === 'function') {
          ok = this.player.runCmd(cmd);
        }
        if (!ok && typeof api.runCmd === 'function') {
          ok = api.runCmd(cmd);
        }
        if (!ok && typeof api.runcmdEx === 'function') {
          const res = api.runcmdEx(cmd);
          ok = res?.success ?? false;
        }
        if (!ok && typeof api.runcmd === 'function') {
          api.runcmd(cmd);
          ok = true;
        }
        if (ok) {
          logger.info(`[SurvivalEngine] 清空主手成功: ${cmd}`);
          return;
        }
      }
    } catch (e) {
      logger.warn('[SurvivalEngine] 清空主手失败', e);
    }
  }
}

