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

import net.minecraft.world.InteractionHand;
import net.minecraft.world.item.BlockItem;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.phys.BlockHitResult;
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

            // 从背包查找方块物品
            net.minecraft.world.entity.player.Inventory inventory = bot.getInventory();
            int slot = -1;
            for (int i = 0; i < inventory.getContainerSize(); i++) {
                ItemStack stack = inventory.getItem(i);
                if (!stack.isEmpty() && stack.getItem() instanceof BlockItem blockItem) {
                    // 将下划线转换为空格，兼容 "stone" 和 "Stone" 两种格式
                    String itemDisplayName = blockItem.getBlock().getName().getString().toLowerCase().replace('_', ' ');
                    if (itemDisplayName.contains(blockName.toLowerCase().replace('_', ' '))) {
                        slot = i;
                        break;
                    }
                }
            }

            if (slot == -1) {
                return new BlockResult(false, "背包中没有找到方块: " + blockName, null);
            }

            // 查找目标方块状态
            Block targetBlock = getBlockByName(blockName, level);
            if (targetBlock == null) {
                return new BlockResult(false, "无法找到方块类型: " + blockName, null);
            }
            
            // 直接设置方块（不使用 useOn 避免位置计算问题）
            level.setBlock(pos, targetBlock.defaultBlockState(), 3);

            Map<String, Object> data = new HashMap<>();
            data.put("x", x);
            data.put("y", y);
            data.put("z", z);
            data.put("block", blockName);

            return new BlockResult(true, 
                    String.format("已放置 %s 在 (%d,%d,%d)", blockName, x, y, z), 
                    data);
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
            ServerLevel level = (ServerLevel) bot.level();
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

            // 区域操作：逐个方块执行（不允许使用 /fill 命令）
            int totalPlaced = 0;
            int totalFailed = 0;

            for (int bx = Math.min(fromX, toX); bx <= Math.max(fromX, toX); bx++) {
                for (int by = Math.min(fromY, toY); by <= Math.max(fromY, toY); by++) {
                    for (int bz = Math.min(fromZ, toZ); bz <= Math.max(fromZ, toZ); bz++) {
                        BlockPos currentPos = new BlockPos(bx, by, bz);
                        BlockState currentState = level.getBlockState(currentPos);

                        switch (mode) {
                            case "fill":
                                // 填充方块（需要 blockName）
                                if (blockName == null) {
                                    return new BlockResult(false, "fill 模式需要提供 block_name", null);
                                }
                                // 查找方块物品
                                if (findBlockItem(bot, blockName) == null) {
                                    BlockResult r = new BlockResult(false, "背包中没有找到方块: " + blockName, null);
                                    return new BlockResult(false, r.message(), null);
                                }
                                // 使用 setBlock 替代
                                Block targetBlock = getBlockByName(blockName, level);
                                if (targetBlock != null) {
                                    level.setBlock(currentPos, targetBlock.defaultBlockState(), 3);
                                    totalPlaced++;
                                } else {
                                    totalFailed++;
                                }
                                break;

                            case "clear":
                                // 清除方块（设为空气）
                                if (!currentState.isAir()) {
                                    level.destroyBlock(currentPos, false);
                                    totalPlaced++;
                                }
                                break;

                            case "break":
                                // 破坏方块（掉落物品）
                                if (!currentState.isAir()) {
                                    level.destroyBlock(currentPos, true);
                                    totalPlaced++;
                                }
                                break;

                            case "vein":
                                // 矿脉扫描（当前仅返回扫描结果，不实际挖掘）
                                totalPlaced++;
                                break;

                            default:
                                return new BlockResult(false, "无效的操作模式: " + mode, null);
                        }
                    }
                }
            }

            Map<String, Object> data = new HashMap<>();
            data.put("mode", mode);
            data.put("fromX", fromX);
            data.put("fromY", fromY);
            data.put("fromZ", fromZ);
            data.put("toX", toX);
            data.put("toY", toY);
            data.put("toZ", toZ);
            data.put("totalBlocks", totalBlocks);
            data.put("completed", totalPlaced);
            data.put("failed", totalFailed);

            if (totalFailed > 0) {
                return new BlockResult(true, 
                        String.format("区域操作 %s 完成: %d/%d 成功, %d 失败", mode, totalPlaced, totalBlocks, totalFailed), 
                        data);
            }

            return new BlockResult(true, 
                    String.format("区域操作 %s 完成: %d 个方块", mode, totalPlaced), 
                    data);
        } catch (Exception e) {
            LOG.error("Failed to perform area operation", e);
            return new BlockResult(false, "区域操作失败: " + e.getMessage(), null);
        }
    }

    // ---- 辅助方法 ----

    /**
     * 在背包中查找方块物品。
     */
    private static ItemStack findBlockItem(ServerPlayer bot, String blockName) {
        net.minecraft.world.entity.player.Inventory inventory = bot.getInventory();
        for (int i = 0; i < inventory.getContainerSize(); i++) {
            ItemStack stack = inventory.getItem(i);
            if (!stack.isEmpty() && stack.getItem() instanceof BlockItem blockItem) {
                // 将下划线转换为空格，兼容 "stone" 和 "Stone" 两种格式
                String itemDisplayName = blockItem.getBlock().getName().getString().toLowerCase().replace('_', ' ');
                if (itemDisplayName.contains(blockName.toLowerCase().replace('_', ' '))) {
                    return stack;
                }
            }
        }
        return null;
    }

    /**
     * 根据名称获取方块实例。
     */
    private static Block getBlockByName(String name, ServerLevel level) {
        // 将下划线转换为空格
        String searchName = name.toLowerCase().replace('_', ' ');
        // 尝试通过内置方块注册表查找
        for (var block : net.minecraft.core.registries.BuiltInRegistries.BLOCK) {
            String blockName = block.getName().getString().toLowerCase().replace('_', ' ');
            if (blockName.contains(searchName)) {
                return block;
            }
        }
        return null;
    }

    // ---- 数据记录 ----

    public record BlockResult(boolean success, String message, Map<String, Object> data) {}
}
