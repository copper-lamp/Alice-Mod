package io.alice.mod.adapter.api.types;

import java.util.UUID;

/**
 * 实体摘要信息。
 */
public record EntityInfo(
        UUID uuid,
        String type,
        Vec3 position,
        String name,
        float health,
        float maxHealth
) {}
