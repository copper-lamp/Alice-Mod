/**
 * V5 背包操作引擎 — ContainerAPI
 *
 * 封装与容器方块的交互：打开、取出、放入、关闭。
 */

import type { TransferResult } from './types.js';
import { normalizeName, matchName } from './InventoryEngine.js';
import { getMaxStackSize } from './stack-size.js';

const MAX_INTERACTION_DISTANCE = 5;
const APPROACH_DISTANCE = 2;

export class ContainerAPI {
  private player: Player;
  private openBlock: Block | null = null;

  constructor(player: Player) {
    this.player = player;
  }

  /**
   * 打开容器方块
   * @param block 目标容器方块
   * @returns 容器对象，失败返回 null
   */
  open(block: Block): Container | null {
    if (!this.isWithinReach(block)) {
      return null;
    }

    try {
      const container = block.getContainer();
      if (!container) {
        return null;
      }
      this.openBlock = block;
      return container;
    } catch (e) {
      return null;
    }
  }

  /**
   * 关闭当前打开的容器（清理引用）
   */
  close(): void {
    this.openBlock = null;
  }

  /**
   * 从容器取出物品到玩家背包
   * @param container 已打开的容器
   * @param itemName 物品名称，未指定时取出容器内所有物品
   * @param count 数量，未指定时取出所有匹配物品
   */
  take(container: Container, itemName?: string, count?: number): TransferResult {
    const inventory = this.player.getInventory();
    if (!inventory) {
      return { success: false, error: '无法获取玩家背包' };
    }

    const requested = count ?? Infinity;
    if (requested <= 0) {
      return { success: false, error: '取出数量无效' };
    }

    const sourceSlots = this.findMatchingSlots(container, itemName);
    if (sourceSlots.length === 0) {
      const reason = itemName ? `容器中没有物品: ${itemName}` : '容器为空';
      return { success: false, error: reason };
    }

    let transferred = 0;
    for (const slot of sourceSlots) {
      if (transferred >= requested) break;
      const moved = this.transfer(container, inventory, slot, requested - transferred);
      transferred += moved;
    }

    if (transferred === 0) {
      return { success: false, error: '背包已满，无法取出' };
    }

    return {
      success: true,
      item: itemName,
      transferred,
      remaining: count !== undefined ? Math.max(0, count - transferred) : 0,
    };
  }

  /**
   * 将玩家背包物品放入容器
   * @param container 已打开的容器
   * @param itemName 物品名称，未指定时放入背包所有可放入物品
   * @param count 数量，未指定时放入所有匹配物品
   */
  put(container: Container, itemName?: string, count?: number): TransferResult {
    const inventory = this.player.getInventory();
    if (!inventory) {
      return { success: false, error: '无法获取玩家背包' };
    }

    const requested = count ?? Infinity;
    if (requested <= 0) {
      return { success: false, error: '放入数量无效' };
    }

    const sourceSlots = this.findMatchingSlots(inventory, itemName);
    if (sourceSlots.length === 0) {
      const reason = itemName ? `背包中没有物品: ${itemName}` : '背包为空';
      return { success: false, error: reason };
    }

    let transferred = 0;
    for (const slot of sourceSlots) {
      if (transferred >= requested) break;
      const moved = this.transfer(inventory, container, slot, requested - transferred);
      transferred += moved;
    }

    if (transferred === 0) {
      return { success: false, error: '容器已满，无法放入' };
    }

    return {
      success: true,
      item: itemName,
      transferred,
      remaining: count !== undefined ? Math.max(0, count - transferred) : 0,
    };
  }

  /**
   * 计算靠近容器时的目标坐标
   */
  computeApproachTarget(blockPos: { x: number; y: number; z: number }, distance: number = APPROACH_DISTANCE): { x: number; y: number; z: number } {
    const playerPos = { x: this.player.pos.x, y: this.player.pos.y, z: this.player.pos.z };
    const dx = playerPos.x - blockPos.x;
    const dy = playerPos.y - blockPos.y;
    const dz = playerPos.z - blockPos.z;
    const horizontal = Math.sqrt(dx * dx + dz * dz);

    if (horizontal <= distance) {
      return { x: playerPos.x, y: playerPos.y, z: playerPos.z };
    }

    const ratio = distance / horizontal;
    return {
      x: blockPos.x + dx * ratio,
      y: blockPos.y + dy * ratio,
      z: blockPos.z + dz * ratio,
    };
  }

  /**
   * 获取当前打开的容器方块
   */
  getOpenBlock(): Block | null {
    return this.openBlock;
  }

  /**
   * 在容器中查找匹配物品的所有槽位
   */
  private findMatchingSlots(container: Container, itemName?: string): number[] {
    const slots: number[] = [];
    const size = container.size ?? 0;
    const normalized = itemName ? normalizeName(itemName) : null;

    for (let i = 0; i < size; i++) {
      const item = container.getItem(i);
      if (!item || item.isNull()) continue;
      if (!normalized || matchName(item.name, itemName!)) {
        slots.push(i);
      }
    }

    return slots;
  }

  /**
   * 判断玩家是否在容器交互范围内
   */
  private isWithinReach(block: Block): boolean {
    try {
      const playerPos = { x: this.player.pos.x, y: this.player.pos.y, z: this.player.pos.z };
      const pos = block.getPos();
      const blockPos = { x: pos.x + 0.5, y: pos.y + 0.5, z: pos.z + 0.5 };
      const dx = playerPos.x - blockPos.x;
      const dy = playerPos.y - blockPos.y;
      const dz = playerPos.z - blockPos.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      return dist <= MAX_INTERACTION_DISTANCE;
    } catch (e) {
      return false;
    }
  }

  /**
   * 将源容器指定槽位的物品转移到目标容器
   * @returns 实际转移数量
   */
  private transfer(source: Container, dest: Container, sourceSlot: number, maxAmount: number): number {
    const item = source.getItem(sourceSlot);
    if (!item || item.isNull()) return 0;

    const toMoveTotal = Math.min(maxAmount, item.count);
    if (toMoveTotal <= 0) return 0;

    const maxStack = getMaxStackSize(item.name);
    let moved = 0;

    // 1. 优先合并到目标容器中已有同类物品的槽位
    const destSize = dest.size ?? 0;
    for (let i = 0; i < destSize && moved < toMoveTotal; i++) {
      const destItem = dest.getItem(i);
      if (!destItem || destItem.isNull()) continue;
      if (normalizeName(destItem.name) !== normalizeName(item.name)) continue;
      if (destItem.count >= maxStack) continue;

      const space = maxStack - destItem.count;
      const amount = Math.min(toMoveTotal - moved, space, item.count);
      if (amount <= 0) continue;

      const merged = destItem.clone();
      merged.count = destItem.count + amount;
      dest.setItem(i, merged);
      moved += amount;
    }

    // 2. 再填入空槽
    for (let i = 0; i < destSize && moved < toMoveTotal; i++) {
      const destItem = dest.getItem(i);
      if (destItem && !destItem.isNull()) continue;

      const amount = Math.min(toMoveTotal - moved, maxStack, item.count);
      if (amount <= 0) continue;

      const clone = item.clone();
      clone.count = amount;
      dest.setItem(i, clone);
      moved += amount;
    }

    if (moved > 0) {
      source.removeItem(sourceSlot, moved);
    }

    return moved;
  }
}
