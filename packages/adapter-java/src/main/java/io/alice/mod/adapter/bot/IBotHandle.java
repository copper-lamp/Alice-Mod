package io.alice.mod.adapter.bot;

import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.phys.Vec3;

import java.util.UUID;

/**
 * 工具层假人操作接口。
 * <p>
 * 工具实现通过 {@code IBotHandle} 操作假人，不直接依赖 {@link AliceBotPlayer}。
 * 保持工具层与假人实现的松耦合。
 */
public interface IBotHandle {

    /** 假人 UUID。 */
    UUID uuid();

    /** 假人名称。 */
    String name();

    /** 假人是否在线（在线 = 已加载到世界中）。 */
    boolean isOnline();

    /** 获取底层 {@link ServerPlayer} 引用。可能为 {@code null}（离线时）。 */
    ServerPlayer getPlayer();

    /** 传送假人到指定位置。 */
    void teleport(double x, double y, double z, ResourceLocation dimension);

    /** 获取当前血量。 */
    float getHealth();

    /** 获取当前最大血量。 */
    float getMaxHealth();

    /** 获取位置。 */
    Vec3 getPosition();

    /** 获取当前维度 ID。 */
    ResourceLocation getDimension();

    /** 获取饥饿值。 */
    int getFoodLevel();

    /** 获取经验等级。 */
    int getExperienceLevel();
}