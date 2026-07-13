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
    try {
      const pos = block.getPos();
      const blockName = (block as any).type || (block as any).name || 'unknown';
      logger.info(`[ContainerAPI] 尝试打开容器 pos=${pos.x},${pos.y},${pos.z} type=${blockName}`);
    } catch (e) {
      // ignore
    }

    if (!this.isWithinReach(block)) {
      logger.warn('[ContainerAPI] 方块距离过远，无法打开');
      return null;
    }

    try {
      let container: Container | null = null;
      if (typeof block.getContainer === 'function') {
        container = block.getContainer();
      }
      // 兜底：部分 LLSE 版本需通过玩家打开容器
      if (!container && typeof (this.player as any).getInventory === 'function') {
        try {
          const inv = (this.player as any).getInventory();
          if (inv && typeof inv.getContainer === 'function') {
            // 仅作尝试，不强制使用
          }
        } catch (e) {
          // ignore
        }
      }
      if (!container) {
        logger.warn('[ContainerAPI] block.getContainer 返回空');
        return null;
      }
      this.openBlock = block;
      return container;
    } catch (e) {
      logger.warn('[ContainerAPI] 打开容器异常', e);
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

    logger.info(`[ContainerAPI] computeApproachTarget player=${JSON.stringify(playerPos)} block=${JSON.stringify(blockPos)} horizontal=${horizontal.toFixed(2)}`);

    if (horizontal <= distance) {
      return { x: playerPos.x, y: playerPos.y, z: playerPos.z };
    }

    const ratio = distance / horizontal;
    const target = {
      x: blockPos.x + dx * ratio,
      y: blockPos.y + dy * ratio,
      z: blockPos.z + dz * ratio,
    };
    logger.info(`[ContainerAPI] approachTarget=${JSON.stringify(target)}`);
    return target;
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
      // 同时按显示名（可能本地化）和内部 type（英文标识符）匹配
      if (!normalized || matchName(item.name, itemName!) || matchName(item.type, itemName!)) {
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
      let bx = 0;
      let by = 0;
      let bz = 0;
      let gotPos = false;

      // 优先使用 getPos()，失败则回退到 .pos 属性
      try {
        if (typeof block.getPos === 'function') {
          const pos = block.getPos();
          if (pos && typeof pos.x === 'number') {
            bx = pos.x;
            by = pos.y;
            bz = pos.z;
            gotPos = true;
          }
        }
      } catch (e) {
        // ignore
      }

      if (!gotPos && block.pos && typeof block.pos.x === 'number') {
        bx = block.pos.x;
        by = block.pos.y;
        bz = block.pos.z;
        gotPos = true;
      }

      if (!gotPos) {
        logger.warn('[ContainerAPI] isWithinReach 无法获取方块坐标');
        return false;
      }

      const blockPos = { x: bx + 0.5, y: by + 0.5, z: bz + 0.5 };
      const dx = playerPos.x - blockPos.x;
      const dy = playerPos.y - blockPos.y;
      const dz = playerPos.z - blockPos.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      logger.info(`[ContainerAPI] isWithinReach player=${JSON.stringify(playerPos)} blockCenter=${JSON.stringify(blockPos)} dist=${dist.toFixed(2)} max=${MAX_INTERACTION_DISTANCE}`);
      return dist <= MAX_INTERACTION_DISTANCE;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      logger.warn(`[ContainerAPI] isWithinReach 异常: ${message}`);
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

    const itemType = normalizeName(item.type || item.name);
    const maxStack = getMaxStackSize(itemType);
    let moved = 0;

    // 1. 优先合并到目标容器中已有同类物品的槽位
    const destSize = dest.size ?? 0;
    for (let i = 0; i < destSize && moved < toMoveTotal; i++) {
      const destItem = dest.getItem(i);
      if (!destItem || destItem.isNull()) continue;
      if (normalizeName(destItem.name) !== itemType && normalizeName(destItem.type) !== itemType) continue;
      if (destItem.count >= maxStack) continue;

      const space = maxStack - destItem.count;
      const amount = Math.min(toMoveTotal - moved, space, item.count);
      if (amount <= 0) continue;

      const merged = mc.newItem(itemType, destItem.count + amount, null);
      if (!merged) continue;
      dest.setItem(i, merged);
      moved += amount;
    }

    // 2. 再填入空槽
    for (let i = 0; i < destSize && moved < toMoveTotal; i++) {
      const destItem = dest.getItem(i);
      if (destItem && !destItem.isNull()) continue;

      const amount = Math.min(toMoveTotal - moved, maxStack, item.count);
      if (amount <= 0) continue;

      const clone = mc.newItem(itemType, amount, null);
      if (!clone) continue;
      dest.setItem(i, clone);
      moved += amount;
    }

    if (moved > 0) {
      source.removeItem(sourceSlot, moved);
    }

    return moved;
  }
}
