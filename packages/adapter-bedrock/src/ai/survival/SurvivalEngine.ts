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
import { FoodSelector, getFoodInfo, isFood } from './FoodSelector.js';
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
      if (!isFood(found.item.name)) {
        return { success: false, error: 'CANNOT_EAT', durationMs: Date.now() - start };
      }
      targetSlot = {
        name: found.item.name,
        count: found.item.count,
        slot: found.slot,
        source: found.source,
      };
      foodInfo = getFoodInfo(found.item.name)!;
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
        this.player.wake();
      } catch (e) {
        // 忽略 wake 异常
      }
      return { success: true, sleptDuration: 0 };
    }

    const cfg = configManager.survival.sleep;
    const waitTime = maxWaitMs ?? cfg.max_wait_ms;

    const bed = bedPos
      ? { pos: bedPos, block: this.world.getBlock(bedPos.x, bedPos.y, bedPos.z) }
      : this.bedFinder.findNearest(this.getPlayerPosition(), cfg.max_bed_search_radius);

    if (!bed || !bed.block || !isBed(bed.block.name)) {
      return { success: false, error: 'NO_BED' };
    }

    const moveResult = await aiEngine.moveTo(this.botName, bed.pos);
    if (!moveResult.success) {
      return { success: false, error: moveResult.reason || 'MOVE_FAILED', sleptDuration: 0 };
    }

    const check = this.bedFinder.checkSleepConditions(bed.pos, this.player);
    if (!check.ok) {
      return { success: false, error: check.reason, sleptDuration: 0 };
    }

    const sleepStart = Date.now();
    try {
      this.player.sleep(bed.block);
    } catch (e) {
      // 部分 LLSE 版本使用 simulateSleep
      try {
        this.player.simulateSleep(bed.pos);
      } catch (e2) {
        return { success: false, error: 'SLEEP_FAILED' };
      }
    }

    await waitFor(() => !this.isSleeping() || this.isDayTime(), waitTime, 500);

    if (this.isSleeping()) {
      try {
        this.player.wake();
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
}

function waitFor(condition: () => boolean, timeoutMs: number, intervalMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      if (condition()) {
        resolve(true);
        return;
      }
      if (Date.now() - start > timeoutMs) {
        resolve(false);
        return;
      }
      setTimeout(check, intervalMs);
    };
    check();
  });
}
