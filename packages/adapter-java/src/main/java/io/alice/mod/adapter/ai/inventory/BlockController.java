package io.alice.mod.adapter.ai.inventory;

import io.alice.mod.adapter.ai.BotAccess;
import net.minecraft.core.BlockPos;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.Vec3;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.HashMap;
import java.util.Map;

/**
 * 方块 AI 控制器——提供方块操作能力。
 */
public final class BlockController {

    private static final Logger LOG = LoggerFactory.getLogger(BlockController.class);

    private BlockController() {}

    /**
     * 挖掘方块。
     */
    public static BlockResult mineBlock(int x, int y, int z, Map<String, Object> options) {
        ServerPlayer bot = BotAccess.getBot();
        if (bot == null) {
            return new BlockResult(false, "Bot 未找到", null);
        }

        try {
            ServerLevel level = (ServerLevel) bot.level();
            BlockPos pos = new BlockPos(x, y, z);
            BlockState state = level.getBlockState(pos);

            if (state.isAir()) {
                return new BlockResult(false, "该位置没有方块", null);
            }

            // 检查距离
            double distance = bot.position().distanceTo(Vec3.atCenterOf(pos));
            if (distance > 6) {
                return new BlockResult(false, "方块距离过远: " + String.format("%.1f", distance) + "格", null);
            }

            // 简单实现：直接破坏方块（后续版本实现挖掘动画和工具选择）
            boolean silkTouch = options != null && Boolean.TRUE.equals(options.get("silk_touch"));
            
            // 破坏方块并掉落物品
            level.destroyBlock(pos, !silkTouch);

            Map<String, Object> data = new HashMap<>();
            data.put("x", x);
            data.put("y", y);
            data.put("z", z);
            data.put("block", state.getBlock().getName().getString());

            return new BlockResult(true, 
                    String.format("已挖掘 %s (%d,%d,%d)", state.getBlock().getName().getString(), x, y, z), 
                    data);
        } catch (Exception e) {
            LOG.error("Failed to mine block", e);
            return new BlockResult(false, "挖掘失败: " + e.getMessage(), null);
        }
    }

    /**
     * 放置方块。
     */
    public static BlockResult placeBlock(int x, int y, int z, String blockName, String facing) {
        ServerPlayer bot = BotAccess.getBot();
        if (bot == null) {
            return new BlockResult(false, "Bot 未找到", null);
        }

        try {
            ServerLevel level = (ServerLevel) bot.level();
            BlockPos pos = new BlockPos(x, y, z);
            BlockState currentState = level.getBlockState(pos);

            if (!currentState.isAir() && !currentState.canBeReplaced()) {
                return new BlockResult(false, "该位置已有方块", null);
            }

            // 检查距离
            double distance = bot.position().distanceTo(Vec3.atCenterOf(pos));
            if (distance > 6) {
                return new BlockResult(false, "方块距离过远: " + String.format("%.1f", distance) + "格", null);
            }

            // TODO: 实现从背包选择方块并放置（需要访问 Inventory 和 BlockItem）
            // 当前返回占位结果
            return new BlockResult(false, "方块放置暂未实现", null);
        } catch (Exception e) {
            LOG.error("Failed to place block", e);
            return new BlockResult(false, "放置失败: " + e.getMessage(), null);
        }
    }

    /**
     * 使用方块（右键点击）。
     */
    public static BlockResult useBlock(int x, int y, int z) {
        ServerPlayer bot = BotAccess.getBot();
        if (bot == null) {
            return new BlockResult(false, "Bot 未找到", null);
        }

        try {
            ServerLevel level = (ServerLevel) bot.level();
            BlockPos pos = new BlockPos(x, y, z);
            BlockState state = level.getBlockState(pos);

            if (state.isAir()) {
                return new BlockResult(false, "该位置没有方块", null);
            }

            // 检查距离
            double distance = bot.position().distanceTo(Vec3.atCenterOf(pos));
            if (distance > 6) {
                return new BlockResult(false, "方块距离过远: " + String.format("%.1f", distance) + "格", null);
            }

            // 模拟右键点击
            BlockHitResult hitResult = new BlockHitResult(
                    Vec3.atCenterOf(pos),
                    net.minecraft.core.Direction.UP,
                    pos,
                    false
            );

            state.useItemOn(bot.getMainHandItem(), (net.minecraft.world.level.Level) level, (net.minecraft.world.entity.player.Player) bot,
                    InteractionHand.MAIN_HAND, hitResult);

            Map<String, Object> data = new HashMap<>();
            data.put("x", x);
            data.put("y", y);
            data.put("z", z);
            data.put("block", state.getBlock().getName().getString());

            return new BlockResult(true, 
                    String.format("已使用 %s (%d,%d,%d)", state.getBlock().getName().getString(), x, y, z), 
                    data);
        } catch (Exception e) {
            LOG.error("Failed to use block", e);
            return new BlockResult(false, "使用失败: " + e.getMessage(), null);
        }
    }

    /**
     * 区域操作。
     */
    public static BlockResult areaOperation(String mode, int fromX, int fromY, int fromZ,
                                            int toX, int toY, int toZ, String blockName, int radius) {
        ServerPlayer bot = BotAccess.getBot();
        if (bot == null) {
            return new BlockResult(false, "Bot 未找到", null);
        }

        try {
            // 计算区域大小
            int sizeX = Math.abs(toX - fromX) + 1;
            int sizeY = Math.abs(toY - fromY) + 1;
            int sizeZ = Math.abs(toZ - fromZ) + 1;
            int totalBlocks = sizeX * sizeY * sizeZ;

            // 限制最大操作方块数
            int maxBlocks = 256;
            if (totalBlocks > maxBlocks) {
                return new BlockResult(false, 
                        String.format("区域过大: %d 个方块（最大 %d）", totalBlocks, maxBlocks), 
                        null);
            }

            // TODO: 实现区域操作（fill/clear/break/vein 四种模式）
            // 当前返回占位结果
            return new BlockResult(false, "区域操作暂未实现", null);
        } catch (Exception e) {
            LOG.error("Failed to perform area operation", e);
            return new BlockResult(false, "区域操作失败: " + e.getMessage(), null);
        }
    }

    // ---- 数据记录 ----

    public record BlockResult(boolean success, String message, Map<String, Object> data) {}
}
