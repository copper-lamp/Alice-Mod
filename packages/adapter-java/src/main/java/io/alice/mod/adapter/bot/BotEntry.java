package io.alice.mod.adapter.bot;

import net.minecraft.core.BlockPos;
import net.minecraft.resources.ResourceLocation;

/**
 * 假人注册表条目。
 * <p>
 * 记录假人的持久化元信息：名称、最后所在维度、最后位置、创建时间。
 * 身躯数据（背包、血量、经验等）由 Minecraft 的 {@code .dat} 存档自动管理。
 *
 * @param name      假人名称（唯一标识）
 * @param dimension 最后所在维度的 ID
 * @param position  最后所在位置的方块坐标
 * @param createdAt 创建时间戳（毫秒）
 */
public record BotEntry(
        String name,
        ResourceLocation dimension,
        BlockPos position,
        long createdAt
) {
    public BotEntry(String name, ResourceLocation dimension, BlockPos position) {
        this(name, dimension, position, System.currentTimeMillis());
    }
}