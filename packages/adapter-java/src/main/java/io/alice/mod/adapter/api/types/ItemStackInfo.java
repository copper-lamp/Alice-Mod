package io.alice.mod.adapter.api.types;

import java.util.Map;

/**
 * 物品堆信息。
 */
public record ItemStackInfo(
        int slot,
        String itemId,
        int count,
        Map<String, Object> components
) {}
