/**
 * 背包操作引擎统一入口
 *
 * 导出 InventoryEngine、ContainerAPI 与相关类型，供 V5/V6/V7 等模块复用。
 */

export { InventoryEngine, normalizeName, matchName } from './InventoryEngine.js';
export { ContainerAPI } from './ContainerAPI.js';
export type {
  ArmorSlot,
  DropResult,
  EquipResult,
  InventorySource,
  ItemSlot,
  ItemStack,
  TransferResult,
  ContainerSlotCandidate,
  StackSizeConfig,
} from './types.js';
export { getMaxStackSize } from './stack-size.js';
