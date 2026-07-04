// 背包操作引擎占位

export interface ItemStack {
  id: string;
  count: number;
  slot?: number;
}

export class InventoryEngine {
  async list(): Promise<ItemStack[]> {
    return [];
  }

  async select(slot: number): Promise<void> {
    // TODO: Select hotbar slot
  }

  async craft(recipe: string): Promise<boolean> {
    // TODO: Craft item
    return false;
  }

  async drop(item: string, count: number): Promise<void> {
    // TODO: Drop item
  }
}
