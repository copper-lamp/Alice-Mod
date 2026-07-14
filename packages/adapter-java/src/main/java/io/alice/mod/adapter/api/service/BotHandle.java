package io.alice.mod.adapter.api.service;

import io.alice.mod.adapter.api.types.Vec3;

import java.util.UUID;

/**
 * 假人操作句柄。
 * <p>
 * 提供对单个假人的安全访问。不暴露 Minecraft 原生类型，
 * 高阶开发者可通过 {@link #getNativePlayer()} 获取原生实例。
 */
public interface BotHandle {

    /** 假人 UUID。 */
    UUID uuid();

    /** 假人名称。 */
    String name();

    /** 当前位置。 */
    Vec3 position();

    /** 当前维度 ID（如 "minecraft:overworld"）。 */
    String dimension();

    /** 当前血量。 */
    float health();

    /** 最大血量。 */
    float maxHealth();

    /** 饥饿值（0-20）。 */
    int foodLevel();

    /** 经验等级。 */
    int experienceLevel();

    /** 传送假人到指定位置。 */
    void teleport(double x, double y, double z, String dimension);

    /**
     * 获取原生的 Minecraft ServerPlayer 实例。
     * <p>
     * 此方法为逃生舱（escape hatch），允许高阶开发者直接操作 Minecraft 原生 API。
     * 使用时需注意版本兼容性——返回类型可能随 Minecraft 版本变化。
     *
     * @param <T> 原生玩家类型，调用方自行保证类型安全
     * @return 原生 ServerPlayer 实例
     */
    <T> T getNativePlayer();
}
