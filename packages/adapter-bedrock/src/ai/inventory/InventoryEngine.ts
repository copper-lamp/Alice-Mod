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
        result.push({ name: item.name, type: item.type, count: item.count, slot: 0, source: 'offhand' });
      }
    }

    const inventory = this.player.getInventory();
    if (inventory) {
      const size = inventory.size ?? 36;
      for (let i = 0; i < size; i++) {
        const item = inventory.getItem(i);
        if (item && !item.isNull()) {
          result.push({ name: item.name, type: item.type, count: item.count, slot: i, source: 'inventory' });
        }
      }
    }

    const armor = this.player.getArmor();
    if (armor) {
      const size = armor.size ?? 4;
      for (let i = 0; i < size; i++) {
        const item = armor.getItem(i);
        if (item && !item.isNull()) {
          result.push({ name: item.name, type: item.type, count: item.count, slot: i, source: 'armor' });
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
      if (!item || item.isNull()) return;
      // 同时按显示名（可能本地化）和内部 type（英文标识符）匹配
      if (matchName(item.name, normalized) || matchName(item.type, normalized)) {
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
   * 设置当前选中的快捷栏槽位（LLSE 部分版本支持）。
   * 若 LLSE API 无法切换，则通过 /item replace 或 /replaceitem 命令把目标槽位物品放入主手。
   */
  selectSlot(slot: number): boolean {
    if (slot < 0) return false;

    const mainSlot = this.player.selectedSlot ?? 0;
    if (mainSlot === slot) {
      return true;
    }

    // 1. 尝试 LLSE 原生 API
    try {
      if (typeof this.player.setSelectedSlot === 'function') {
        const ok = this.player.setSelectedSlot(slot);
        logger.info(`[InventoryEngine] setSelectedSlot(${slot}) => ${ok}`);
        if (ok && this.player.selectedSlot === slot) {
          return true;
        }
      }
    } catch (e) {
      logger.warn(`[InventoryEngine] setSelectedSlot(${slot}) 异常`, e);
    }

    // 2. 直接赋值（部分版本支持）
    try {
      this.player.selectedSlot = slot;
      if (this.player.selectedSlot === slot) {
        logger.info(`[InventoryEngine] selectedSlot 赋值为 ${slot}`);
        return true;
      }
    } catch (e) {
      logger.warn(`[InventoryEngine] selectedSlot 赋值异常`, e);
    }

    // 3. 通过背包交换把目标槽位物品移到主手（不依赖命令权限）
    try {
      if (this.swapToMainHand(slot)) {
        logger.info(`[InventoryEngine] 通过背包交换将槽位 ${slot} 物品移入主手`);
        return true;
      }
    } catch (e) {
      logger.warn('[InventoryEngine] 背包交换兜底失败', e);
    }

    // 4. 最后兜底：使用命令将目标槽位物品替换到主手
    try {
      const inventory = this.player.getInventory();
      if (inventory && typeof inventory.getItem === 'function') {
        const item = inventory.getItem(slot);
        if (item && !item.isNull()) {
          const itemId = normalizeName(item.type || item.name);
          if (this.replaceMainHand(itemId)) {
            logger.info(`[InventoryEngine] 命令将 ${itemId} 放入主手（槽位 ${slot}）`);
            return true;
          }
        }
      }
    } catch (e) {
      logger.warn('[InventoryEngine] 主手替换兜底失败', e);
    }

    return false;
  }

  /**
   * 使用 /item replace 或 /replaceitem 命令替换主手物品（兼容新旧 MC 版本）。
   */
  private replaceMainHand(itemId: string): boolean {
    const normalizedId = itemId.replace(/^minecraft:/, '');
    const selector = `"${this.player.realName}"`;

    // 新版命令（1.19.80+）: item replace entity <selector> weapon.mainhand with <item>
    const newCmd = `item replace entity ${selector} weapon.mainhand with ${normalizedId} 1`;
    // 旧版命令: replaceitem entity <selector> slot.weapon.mainhand <item> <count> [data]
    const oldCmd = `replaceitem entity ${selector} slot.weapon.mainhand ${normalizedId} 1 0`;

    for (const cmd of [newCmd, oldCmd]) {
      try {
        let ok = false;
        const api = mc as any;
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
          logger.info(`[InventoryEngine] 执行主手替换命令成功: ${cmd}`);
          return true;
        }
      } catch (e) {
        logger.warn(`[InventoryEngine] 主手替换命令失败: ${cmd}`, e);
      }
    }
    return false;
  }

  /**
   * 将指定背包槽位的物品移动到当前主手槽位。
   * 用于 LLSE 无法切换 selectedSlot 时的最后兜底。
   */
  private swapToMainHand(slot: number): boolean {
    const inventory = this.player.getInventory();
    if (!inventory || typeof inventory.getItem !== 'function' || typeof inventory.setItem !== 'function') {
      return false;
    }

    const sourceItem = inventory.getItem(slot);
    if (!sourceItem || sourceItem.isNull()) return false;

    const mainSlot = this.player.selectedSlot ?? 0;
    if (mainSlot === slot) return true;

    const mainItem = inventory.getItem(mainSlot);
    const targetType = normalizeName(sourceItem.type || sourceItem.name);

    try {
      // 使用 mc.newItem 创建新副本，避免 LLSE 对 clone() 对象的引用限制
      const targetClone = mc.newItem(targetType, sourceItem.count, null) ?? sourceItem.clone();
      inventory.setItem(mainSlot, targetClone);
      // 原槽位放回主手原有物品（简单交换）
      if (mainItem && !mainItem.isNull()) {
        const mainType = normalizeName(mainItem.type || mainItem.name);
        const mainClone = mc.newItem(mainType, mainItem.count, null) ?? mainItem.clone();
        inventory.setItem(slot, mainClone);
      }
      this.refreshItems();
      this.persist();

      // 验证主手是否确实切换
      const newHand = this.player.getHand();
      if (newHand && !newHand.isNull()) {
        const newHandType = normalizeName(newHand.type || newHand.name);
        if (newHandType === targetType) {
          return true;
        }
      }
      logger.warn(`[InventoryEngine] swapToMainHand 验证失败，主手仍是 ${newHand?.name ?? '空'}`);
      return false;
    } catch (e) {
      logger.warn('[InventoryEngine] swapToMainHand 异常', e);
      return false;
    }
  }

  /**
   * 刷新玩家物品栏显示
   */
  private refreshItems(): void {
    try {
      if (typeof (this.player as any).refreshItems === 'function') {
        (this.player as any).refreshItems();
      }
    } catch (e) {
      // ignore
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
    // 使用 item.type（英文标识符）创建新物品；LLSE 运行时 Item 可能没有 getExtraTag
    const extra = typeof item.getExtraTag === 'function' ? item.getExtraTag() : null;
    const itemType = normalizeName(item.type || item.name);
    const dropItem = mc.newItem(itemType, dropCount, extra);
    if (!dropItem) {
      return { success: false, error: '创建掉落物品失败' };
    }

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

    // 避免从目标槽位装备到自己；若已装备在目标槽位，直接视为成功
    if (sourceRef.source === destSource && sourceRef.slot === destIndex) {
      return {
        success: true,
        item: sourceRef.item.name,
        slot,
        previousItem: sourceRef.item.name,
      };
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

    const itemType = normalizeName(itemToEquip.type || itemToEquip.name);
    const equipItem = mc.newItem(itemType, 1, null);
    if (!equipItem) {
      return { success: false, error: '创建装备物品失败' };
    }

    try {
      destContainer.setItem(destIndex, equipItem);
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

    const itemType = normalizeName(itemToEquip.type || itemToEquip.name);
    const offhandCount = Math.min(itemToEquip.count, getMaxStackSize(itemType));
    const offhandItem = mc.newItem(itemType, offhandCount, null);
    if (!offhandItem) {
      return { success: false, error: '创建副手物品失败' };
    }

    try {
      // @ts-expect-error — LLSE Player 类型未声明 setOffHand，但运行时可用
      if (typeof this.player.setOffHand === 'function') {
        // @ts-expect-error — LLSE Player 类型未声明 setOffHand，但运行时可用
        this.player.setOffHand(offhandItem);
      } else {
        return { success: false, error: '当前环境不支持设置副手物品' };
      }
      sourceContainer.removeItem(sourceRef.slot, offhandCount);
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

    const airItem = mc.newItem('air', 1, null);
    if (airItem) {
      destContainer.setItem(destIndex, airItem);
    }
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

    const size = inventory.size ?? 36;
    const itemType = normalizeName(item.type || item.name);
    const maxStack = getMaxStackSize(itemType);
    let remaining = item.count;

    // 尝试堆叠到已有槽位
    for (let i = 0; i < size && remaining > 0; i++) {
      const existing = inventory.getItem(i);
      if (!existing || existing.isNull()) continue;
      if (normalizeName(existing.name) !== itemType && normalizeName(existing.type) !== itemType) continue;
      if (existing.count >= maxStack) continue;

      const space = maxStack - existing.count;
      const amount = Math.min(remaining, space);
      if (amount <= 0) continue;

      const merged = mc.newItem(itemType, existing.count + amount, null);
      if (!merged) continue;
      inventory.setItem(i, merged);
      remaining -= amount;
    }

    if (remaining <= 0) {
      return true;
    }

    // 尝试放入空槽
    for (let i = 0; i < size; i++) {
      const existing = inventory.getItem(i);
      if (existing && !existing.isNull()) continue;

      const toPlace = remaining < item.count ? mc.newItem(itemType, remaining, null) : item;
      inventory.setItem(i, toPlace);
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
