/**
 * 物品使用器
 *
 * 支持三种使用模式：use（普通使用）、drink（喝药水）、throw（投掷）。
 */

import type { Vec3 } from '../pathfinding/types.js';
import type { InventoryEngine } from '../inventory/index.js';
import type { UseItemResult } from './types.js';

export type UseItemMode = 'use' | 'drink' | 'throw';

export class ItemUser {
  constructor(
    private player: any,
    private inventoryEngine: InventoryEngine,
  ) {}

  async useItem(itemName: string, mode: UseItemMode, target?: Vec3): Promise<UseItemResult> {
    const slotRef = this.inventoryEngine.find(itemName);
    if (!slotRef) {
      return { success: false, error: 'ITEM_NOT_FOUND' };
    }

    const item = slotRef.item;
    const remainingBefore = item.count;
    this.inventoryEngine.selectSlot(slotRef.slot);

    switch (mode) {
      case 'use':
        return this.useNormal(item.name, remainingBefore);
      case 'drink':
        return this.drink(item.name, remainingBefore);
      case 'throw':
        return this.throwAt(item.name, target, remainingBefore);
      default:
        return { success: false, error: 'UNSUPPORTED_MODE' };
    }
  }

  private async useNormal(itemName: string, remainingBefore: number): Promise<UseItemResult> {
    try {
      this.player.simulateUseItem();
      return {
        success: true,
        item: itemName,
        mode: 'use',
        remaining: remainingBefore,
      };
    } catch (e) {
      return { success: false, error: 'USE_FAILED' };
    }
  }

  private async drink(itemName: string, remainingBefore: number): Promise<UseItemResult> {
    try {
      this.player.simulateUseItem();
      await sleep(1600);
      return {
        success: true,
        item: itemName,
        mode: 'drink',
        remaining: Math.max(0, remainingBefore - 1),
      };
    } catch (e) {
      return { success: false, error: 'DRINK_FAILED' };
    }
  }

  private async throwAt(
    itemName: string,
    target: Vec3 | undefined,
    remainingBefore: number,
  ): Promise<UseItemResult> {
    if (!target) {
      return { success: false, error: 'TARGET_REQUIRED' };
    }

    try {
      if (typeof this.player.simulateLookAt === 'function') {
        this.player.simulateLookAt(target.x, target.y, target.z);
      }

      if (typeof this.player.shootProjectile === 'function') {
        this.player.shootProjectile();
      } else {
        this.player.simulateUseItem();
      }

      return {
        success: true,
        item: itemName,
        mode: 'throw',
        remaining: Math.max(0, remainingBefore - 1),
      };
    } catch (e) {
      return { success: false, error: 'THROW_FAILED' };
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
