package io.alice.mod.adapter.api.service;

import io.alice.mod.adapter.api.types.Vec3;

import java.util.UUID;

/**
 * 假人摘要信息（在线或离线）。
 */
public record BotInfo(
        UUID uuid,
        String name,
        boolean online,
        String dimension,
        Vec3 position,
        float health,
        float maxHealth,
        long createdAt
) {}
