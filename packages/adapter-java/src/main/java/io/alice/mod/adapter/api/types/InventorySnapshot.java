package io.alice.mod.adapter.api.types;

import java.util.List;

/**
 * 背包快照。
 */
public record InventorySnapshot(
        int usedSlots,
        int maxSlots,
        List<ItemStackInfo> items
) {}
