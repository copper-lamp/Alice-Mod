/**
 * V5 背包操作引擎 — InventoryEngine
 *
 * 封装背包查询、物品查找、丢弃、装备等操作。
 */

import { getEntityFeetPos, calcPosFromViewDirection } from '../../utils/helpers.js';
import { BotManager } from '../../bot/BotManager.js';
import type {
  ArmorSlot,
  DropResult,
  EquipResult,
  InventorySource,
  ItemSlot,
  ItemStack,
} from './types.js';
import { getMaxStackSize } from './stack-size.js';

const ARMOR_SLOT_INDEX: Record<ArmorSlot, { source: Extract<InventorySource, 'armor' | 'offhand'>; index: number }> = {
  head: { source: 'armor', index: 0 },
  chest: { source: 'armor', index: 1 },
  legs: { source: 'armor', index: 2 },
  feet: { source: 'armor', index: 3 },
  offhand: { source: 'offhand', index: 0 },
};

export class InventoryEngine {
  constructor(
    private player: Player,
    private botName: string,
  ) {}

  /**
   * 列出玩家所有非空槽位
   */
  list(): ItemStack[] {
    const result: ItemStack[] = [];

    const offhand = this.player.getOffHand();
    if (offhand) {
      const item = typeof offhand.getItem === 'function' ? offhand.getItem(0) : offhand;
      if (item && !item.isNull()) {
        result.push({ name: item.name, count: item.count, slot: 0, source: 'offhand' });
      }
    }

    const inventory = this.player.getInventory();
    if (inventory) {
      const size = inventory.size ?? 36;
      for (let i = 0; i < size; i++) {
        const item = inventory.getItem(i);
        if (item && !item.isNull()) {
          result.push({ name: item.name, count: item.count, slot: i, source: 'inventory' });
        }
      }
    }

    const armor = this.player.getArmor();
    if (armor) {
      const size = armor.size ?? 4;
      for (let i = 0; i < size; i++) {
        const item = armor.getItem(i);
        if (item && !item.isNull()) {
          result.push({ name: item.name, count: item.count, slot: i, source: 'armor' });
        }
      }
    }

    return result;
  }

  /**
   * 按名称查找第一个匹配槽位
   * 查找顺序：主手 > 副手 > 背包 > 盔甲
   */
  find(itemName: string): ItemSlot | null {
    const all = this.findAll(itemName);
    return all.length > 0 ? all[0] : null;
  }

  /**
   * 按名称查找所有匹配槽位
   */
  findAll(itemName: string): ItemSlot[] {
    const normalized = normalizeName(itemName);
    const result: ItemSlot[] = [];

    const pushIfMatch = (source: InventorySource, slot: number, item: Item | null) => {
      if (item && !item.isNull() && matchName(item.name, normalized)) {
        result.push({ source, slot, item });
      }
    };

    const hand = this.player.getHand();
    pushIfMatch('hand', this.player.selectedSlot ?? 0, hand);

    const offhand = this.player.getOffHand();
    const offhandItem = offhand && typeof offhand.getItem === 'function' ? offhand.getItem(0) : offhand;
    pushIfMatch('offhand', 0, offhandItem);

    const inventory = this.player.getInventory();
    if (inventory) {
      const size = inventory.size ?? 36;
      for (let i = 0; i < size; i++) {
        pushIfMatch('inventory', i, inventory.getItem(i));
      }
    }

    const armor = this.player.getArmor();
    if (armor) {
      const size = armor.size ?? 4;
      for (let i = 0; i < size; i++) {
        pushIfMatch('armor', i, armor.getItem(i));
      }
    }

    return result;
  }

  /**
   * 获取当前选中的快捷栏槽位
   */
  getSelectedSlot(): number {
    return this.player.selectedSlot ?? 0;
  }

  /**
   * 设置当前选中的快捷栏槽位（LLSE 部分版本支持）
   */
  selectSlot(slot: number): boolean {
    try {
      if (typeof this.player.setSelectedSlot === 'function') {
        this.player.setSelectedSlot(slot);
        return true;
      }
      this.player.selectedSlot = slot;
      return (this.player.selectedSlot ?? 0) === slot;
    } catch (e) {
      return false;
    }
  }

  /**
   * 丢弃物品
   * @param itemName 物品名称，未指定时丢弃当前主手物品
   * @param count 数量，未指定时丢弃全部
   * @param targetEntityId 目标实体 ID，指定时向实体位置丢弃
   */
  drop(itemName?: string, count?: number, targetEntityId?: string): DropResult {
    let slotRef: ItemSlot | null;

    if (itemName) {
      slotRef = this.find(itemName);
      if (!slotRef) {
        return { success: false, error: `背包中未找到物品: ${itemName}` };
      }
    } else {
      const hand = this.player.getHand();
      if (!hand || hand.isNull()) {
        return { success: false, error: '主手为空，无法丢弃' };
      }
      slotRef = { source: 'hand', slot: this.getSelectedSlot(), item: hand };
    }

    return this.dropSlot(slotRef, count, targetEntityId);
  }

  /**
   * 丢弃指定槽位的物品
   */
  dropSlot(slotRef: ItemSlot, count?: number, targetEntityId?: string): DropResult {
    const container = this.getContainer(slotRef.source);
    if (!container) {
      return { success: false, error: '无法获取物品容器' };
    }

    const item = container.getItem(slotRef.slot);
    if (!item || item.isNull()) {
      return { success: false, error: '槽位为空' };
    }

    const dropCount = Math.min(count ?? item.count, item.count);
    if (dropCount <= 0) {
      return { success: false, error: '丢弃数量无效' };
    }

    const originalCount = item.count;
    const dropItem = item.clone();
    dropItem.count = dropCount;

    const dropPos = this.resolveDropPosition(targetEntityId);

    try {
      const entity = mc.spawnItem(dropItem, dropPos);
      if (!entity) {
        return { success: false, error: '生成掉落物失败' };
      }

      container.removeItem(slotRef.slot, dropCount);
      this.persist();

      return {
        success: true,
        item: item.name,
        dropped: dropCount,
        remaining: originalCount - dropCount,
      };
    } catch (e) {
      return { success: false, error: `丢弃失败: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  /**
   * 装备物品到指定部位
   */
  equip(itemName: string, slot: ArmorSlot): EquipResult {
    if (slot === 'offhand') {
      return this.equipOffhand(itemName);
    }

    const target = this.getArmorContainerAndIndex(slot);
    if (!target) {
      return { success: false, error: `无效的装备部位: ${slot}` };
    }

    const { container: destContainer, index: destIndex, source: destSource } = target;

    // 1. 查找要装备的物品（优先背包，其次副手/盔甲）
    const sourceRef = this.find(itemName);
    if (!sourceRef) {
      return { success: false, error: `背包中未找到物品: ${itemName}` };
    }

    // 避免从目标槽位装备到自己
    if (sourceRef.source === destSource && sourceRef.slot === destIndex) {
      return { success: false, error: '目标槽位已经是该物品' };
    }

    // 2. 处理目标槽位已有物品：尝试移回背包
    const destItem = destContainer.getItem(destIndex);
    if (destItem && !destItem.isNull()) {
      const movedBack = this.moveItemToInventory(destItem, destSource, destIndex);
      if (!movedBack) {
        return { success: false, error: `无法卸下当前${slot}部位的物品，背包已满` };
      }
    }

    // 3. 将源物品移动到目标槽位
    const sourceContainer = this.getContainer(sourceRef.source);
    if (!sourceContainer) {
      return { success: false, error: '无法获取源物品容器' };
    }

    const itemToEquip = sourceContainer.getItem(sourceRef.slot);
    if (!itemToEquip || itemToEquip.isNull()) {
      return { success: false, error: '源槽位为空' };
    }

    const clone = itemToEquip.clone();
    clone.count = 1;

    try {
      destContainer.setItem(destIndex, clone);
      sourceContainer.removeItem(sourceRef.slot, 1);
      this.persist();

      return {
        success: true,
        item: itemToEquip.name,
        slot,
        previousItem: destItem && !destItem.isNull() ? destItem.name : undefined,
      };
    } catch (e) {
      return { success: false, error: `装备失败: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  /**
   * 装备物品到副手
   */
  private equipOffhand(itemName: string): EquipResult {
    const currentOffhand = this.player.getOffHand();
    const previousItem = currentOffhand && !currentOffhand.isNull() ? currentOffhand.name : undefined;

    if (currentOffhand && !currentOffhand.isNull()) {
      const movedBack = this.moveItemToInventory(currentOffhand.clone(), 'offhand', 0);
      if (!movedBack) {
        return { success: false, error: '无法卸下当前副手物品，背包已满' };
      }
    }

    const sourceRef = this.find(itemName);
    if (!sourceRef) {
      return { success: false, error: `背包中未找到物品: ${itemName}` };
    }

    const sourceContainer = this.getContainer(sourceRef.source);
    if (!sourceContainer) {
      return { success: false, error: '无法获取源物品容器' };
    }

    const itemToEquip = sourceContainer.getItem(sourceRef.slot);
    if (!itemToEquip || itemToEquip.isNull()) {
      return { success: false, error: '源槽位为空' };
    }

    const clone = itemToEquip.clone();
    clone.count = Math.min(itemToEquip.count, getMaxStackSize(itemToEquip.name));

    try {
      // @ts-expect-error — LLSE Player 类型未声明 setOffHand，但运行时可用
      if (typeof this.player.setOffHand === 'function') {
        // @ts-expect-error — LLSE Player 类型未声明 setOffHand，但运行时可用
        this.player.setOffHand(clone);
      } else {
        return { success: false, error: '当前环境不支持设置副手物品' };
      }
      sourceContainer.removeItem(sourceRef.slot, clone.count);
      this.persist();

      return {
        success: true,
        item: itemToEquip.name,
        slot: 'offhand',
        previousItem,
      };
    } catch (e) {
      return { success: false, error: `装备副手失败: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  /**
   * 卸下指定部位的装备
   */
  unequip(slot: ArmorSlot): EquipResult {
    if (slot === 'offhand') {
      return this.unequipOffhand();
    }

    const target = this.getArmorContainerAndIndex(slot);
    if (!target) {
      return { success: false, error: `无效的装备部位: ${slot}` };
    }

    const { container: destContainer, index: destIndex } = target;
    const destItem = destContainer.getItem(destIndex);
    if (!destItem || destItem.isNull()) {
      return { success: false, error: `${slot} 部位没有装备` };
    }

    const movedBack = this.moveItemToInventory(destItem, target.source, destIndex);
    if (!movedBack) {
      return { success: false, error: '背包已满，无法卸下装备' };
    }

    destContainer.setItem(destIndex, null);
    this.persist();

    return {
      success: true,
      item: destItem.name,
      slot,
    };
  }

  /**
   * 卸下副手物品
   */
  private unequipOffhand(): EquipResult {
    const currentOffhand = this.player.getOffHand();
    if (!currentOffhand) {
      return { success: false, error: 'offhand 部位没有装备' };
    }

    const offhandItem = currentOffhand.getItem(0);
    if (!offhandItem || offhandItem.isNull()) {
      return { success: false, error: 'offhand 部位没有装备' };
    }

    const movedBack = this.moveItemToInventory(offhandItem.clone(), 'offhand', 0);
    if (!movedBack) {
      return { success: false, error: '背包已满，无法卸下副手装备' };
    }

    try {
      // @ts-expect-error — LLSE Player 类型未声明 setOffHand，但运行时可用
      if (typeof this.player.setOffHand === 'function') {
        // @ts-expect-error — LLSE Player 类型未声明 setOffHand，但运行时可用
        this.player.setOffHand(null);
      } else {
        return { success: false, error: '当前环境不支持清空副手物品' };
      }
      this.persist();

      return {
        success: true,
        item: offhandItem.name,
        slot: 'offhand',
      };
    } catch (e) {
      return { success: false, error: `卸下副手失败: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  /**
   * 获取指定来源的容器
   */
  getContainer(source: InventorySource): Container | null {
    switch (source) {
      case 'hand':
      case 'inventory':
        return this.player.getInventory();
      case 'offhand':
        return null;
      case 'armor':
        return this.player.getArmor();
      default:
        return null;
    }
  }

  /**
   * 获取当前选中的物品
   */
  getSelectedItem(): Item | null {
    const hand = this.player.getHand();
    if (hand && !hand.isNull()) return hand;
    return null;
  }

  /**
   * 获取指定槽位物品
   */
  getItem(source: InventorySource, slot: number): Item | null {
    const container = this.getContainer(source);
    if (!container) return null;
    const item = container.getItem(slot);
    if (!item || item.isNull()) return null;
    return item;
  }

  /**
   * 获取物品当前耐久值（已损失耐久）
   */
  getItemDamage(item: Item): number {
    if (item == null || typeof item !== 'object') return 0;
    if (typeof item.getDamage === 'function') {
      try {
        return item.getDamage();
      } catch (e) {
        return 0;
      }
    }
    return (item as Item & { damage?: number }).damage ?? 0;
  }

  /**
   * 获取物品最大耐久值
   */
  getItemMaxDamage(item: Item): number {
    if (item == null || typeof item !== 'object') return 0;
    if (typeof item.getMaxDamage === 'function') {
      try {
        return item.getMaxDamage();
      } catch (e) {
        return 0;
      }
    }
    return (item as Item & { maxDamage?: number }).maxDamage ?? 0;
  }

  /**
   * 获取玩家对象
   */
  getPlayer(): Player {
    return this.player;
  }

  /**
   * 解析丢弃落点
   */
  resolveDropPosition(targetEntityId?: string): FloatPos {
    if (targetEntityId) {
      try {
        // @ts-expect-error — LLSE mc 类型声明中无 getEntity，但运行时可用
        const entity = mc.getEntity(targetEntityId);
        if (entity && entity.pos) {
          return new FloatPos(entity.pos.x, entity.pos.y, entity.pos.z, entity.pos.dimid ?? this.player.pos.dimid);
        }
      } catch (e) {
        // 实体未找到时回退到玩家前方
      }
    }

    const feetPos = getEntityFeetPos(this.player);
    return calcPosFromViewDirection(feetPos, this.player.direction, 1.5);
  }

  /**
   * 将物品移回背包
   */
  private moveItemToInventory(item: Item, _source: InventorySource, _sourceSlot: number): boolean {
    const inventory = this.player.getInventory();
    if (!inventory) return false;

    // 尝试堆叠到已有槽位
    const size = inventory.size ?? 36;
    const maxStack = getMaxStackSize(item.name);

    for (let i = 0; i < size; i++) {
      const existing = inventory.getItem(i);
      if (!existing || existing.isNull()) continue;
      if (normalizeName(existing.name) !== normalizeName(item.name)) continue;
      if (existing.count >= maxStack) continue;

      const space = maxStack - existing.count;
      const amount = Math.min(item.count, space);
      const clone = item.clone();
      clone.count = existing.count + amount;
      inventory.setItem(i, clone);
      item.count -= amount;
      if (item.count <= 0) {
        return true;
      }
    }

    // 尝试放入空槽
    for (let i = 0; i < size; i++) {
      const existing = inventory.getItem(i);
      if (existing && !existing.isNull()) continue;
      inventory.setItem(i, item);
      return true;
    }

    return false;
  }

  /**
   * 获取指定装备部位对应的容器与索引
   */
  private getArmorContainerAndIndex(slot: ArmorSlot): { container: Container; index: number; source: InventorySource } | null {
    const mapping = ARMOR_SLOT_INDEX[slot];
    if (!mapping) return null;

    const container = this.getContainer(mapping.source);
    if (!container) return null;

    return { container, index: mapping.index, source: mapping.source };
  }

  /**
   * 持久化背包变更
   */
  private persist(): void {
    try {
      BotManager.saveInventory(this.botName);
    } catch (e) {
      logger.warn(`[InventoryEngine] 保存背包失败: ${this.botName}`, e);
    }
  }
}

/**
 * 标准化物品名称
 */
export function normalizeName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/^minecraft:/, '')
    .replace(/\s+/g, '_');
}

/**
 * 判断物品名称是否匹配搜索词
 */
export function matchName(itemName: string, searchName: string): boolean {
  const item = normalizeName(itemName);
  const search = normalizeName(searchName);
  if (item === search) return true;
  // 允许忽略下划线/空格的模糊匹配
  return item.replace(/_/g, '') === search.replace(/_/g, '');
}
