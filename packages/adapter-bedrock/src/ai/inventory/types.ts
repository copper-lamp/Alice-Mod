/**
 * V5 背包操作引擎 — 类型定义
 */

/**
 * 物品槽位来源
 */
export type InventorySource = 'hand' | 'offhand' | 'inventory' | 'armor';

/**
 * 装备槽位
 */
export type ArmorSlot = 'head' | 'chest' | 'legs' | 'feet' | 'offhand';

/**
 * 物品槽位引用
 */
export interface ItemSlot {
  source: InventorySource;
  slot: number;
  item: Item;
}

/**
 * 标准化后的物品快照
 */
export interface ItemStack {
  name: string;
  /** 物品内部类型标识（英文，如 minecraft:dirt）。优先使用此字段进行类型判断 */
  type?: string;
  count: number;
  slot: number;
  source: InventorySource;
}

/**
 * 丢弃结果
 */
export interface DropResult {
  success: boolean;
  item?: string;
  dropped?: number;
  remaining?: number;
  error?: string;
}

/**
 * 装备结果
 */
export interface EquipResult {
  success: boolean;
  item?: string;
  slot?: ArmorSlot;
  previousItem?: string;
  error?: string;
}

/**
 * 容器转移结果
 */
export interface TransferResult {
  success: boolean;
  item?: string;
  transferred?: number;
  remaining?: number;
  error?: string;
}

/**
 * 容器槽位候选
 */
export interface ContainerSlotCandidate {
  slot: number;
  item: Item | null;
  availableSpace: number;
}

/**
 * 物品最大堆叠配置
 */
export interface StackSizeConfig {
  size1: Set<string>;
  size16: Set<string>;
}
