package io.alice.mod.adapter.ai.behavior.task;

import io.alice.mod.adapter.ai.behavior.ITaskRequiresGrounded;
import io.alice.mod.adapter.ai.behavior.Task;
import io.alice.mod.adapter.api.service.BotHandle;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.item.BlockItem;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.Vec3;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * 放置方块任务。
 * <p>
 * 从 altoclef 概念移植。
 * <p>
 * 实现 {@link ITaskRequiresGrounded}，需要落地才能中断。
 * 使用 Carpet 命令模拟玩家放置方块。
 */
public class PlaceBlockTask extends Task implements ITaskRequiresGrounded {

    private static final Logger LOG = LoggerFactory.getLogger(PlaceBlockTask.class);

    // ──────────────────────────────────────────────
    //  常量
    // ──────────────────────────────────────────────

    /** 放置距离（方块）。 */
    private static final double PLACE_RANGE = 5.0;
    /** 放置超时（tick）。 */
    private static final int PLACE_TIMEOUT_TICKS = 100; // 5 秒

    // ──────────────────────────────────────────────
    //  状态
    // ──────────────────────────────────────────────

    private final BlockPos targetPos;
    private final Block blockToPlace;
    private int tickCount = 0;

    // ──────────────────────────────────────────────
    //  构造
    // ──────────────────────────────────────────────

    public PlaceBlockTask(BlockPos pos, Block block) {
        this.targetPos = pos;
        this.blockToPlace = block;
        setDebugState("Place(" + block.getDescriptionId() + ")");
    }

    // ──────────────────────────────────────────────
    //  生命周期
    // ──────────────────────────────────────────────

    @Override
    protected void onStart(BotHandle bot) {
        tickCount = 0;
        LOG.debug("PlaceBlockTask: start placing {} at {}",
                blockToPlace.getDescriptionId(), targetPos);
    }

    @Override
    protected Task onTick(BotHandle bot) {
        ServerPlayer player = bot.getNativePlayer();
        if (player == null) return null;

        tickCount++;

        // 超时检查
        if (tickCount > PLACE_TIMEOUT_TICKS) {
            LOG.warn("PlaceBlockTask: timeout at {}", targetPos);
            setDebugState("Place timeout");
            return null;
        }

        // 检查方块是否已被放置
        BlockState state = player.serverLevel().getBlockState(targetPos);
        if (!state.isAir()) {
            // 检查是否是我们放置的方块
            Block existing = state.getBlock();
            if (existing == blockToPlace) {
                setDebugState("Block placed");
                return null;
            }
            // 方块已存在但不是我们想要的，当作完成
            setDebugState("Block occupied");
            return null;
        }

        // 检查是否在范围内
        double dist = Math.sqrt(player.distanceToSqr(
                targetPos.getX(), targetPos.getY(), targetPos.getZ()));
        if (dist > PLACE_RANGE) {
            setDebugState("Moving closer to place");
            return new MoveToTask(io.alice.mod.adapter.api.types.Vec3.of(
                    targetPos.getX() + 0.5,
                    targetPos.getY(),
                    targetPos.getZ() + 0.5
            ));
        }

        // 装备方块
        equipBlock(bot, player);

        // 面向目标方块旁边的面
        Direction face = getPlacementFace(player, targetPos);
        BlockPos facePos = targetPos.relative(face.getOpposite());

        String lookCmd = String.format("player %s lookAt %.2f %.2f %.2f",
                bot.name(),
                facePos.getX() + 0.5 + face.getStepX() * 0.5,
                facePos.getY() + 0.5 + face.getStepY() * 0.5,
                facePos.getZ() + 0.5 + face.getStepZ() * 0.5);
        executeCommand(bot, lookCmd);

        // 放置方块
        String useCmd = String.format("player %s useItem", bot.name());
        executeCommand(bot, useCmd);

        setDebugState("Placing...");
        return null;
    }

    @Override
    protected void onStop(BotHandle bot, Task interruptTask) {
        String stopCmd = String.format("player %s useItem stop", bot.name());
        executeCommand(bot, stopCmd);
        LOG.debug("PlaceBlockTask: stopped");
    }

    @Override
    public boolean isFinished(BotHandle bot) {
        ServerPlayer player = bot.getNativePlayer();
        if (player == null) return true;
        BlockState state = player.serverLevel().getBlockState(targetPos);
        return !state.isAir();
    }

    // ──────────────────────────────────────────────
    //  工具方法
    // ──────────────────────────────────────────────

    private void equipBlock(BotHandle bot, ServerPlayer player) {
        // 简化版：在背包中查找方块并装备
        // TODO: 使用 InventoryService 实现更完善的装备逻辑
        String equipCmd = String.format("player %s equip %s",
                bot.name(), blockToPlace.getDescriptionId());
        executeCommand(bot, equipCmd);
    }

    private Direction getPlacementFace(ServerPlayer player, BlockPos target) {
        // 计算玩家与目标的位置关系，选择最合适的放置面
        Vec3 playerPos = player.position();
        double dx = target.getX() + 0.5 - playerPos.x;
        double dy = target.getY() + 0.5 - playerPos.y;
        double dz = target.getZ() + 0.5 - playerPos.z;

        Direction best = Direction.UP;
        double bestDot = Double.NEGATIVE_INFINITY;

        for (Direction dir : Direction.values()) {
            double dot = dx * dir.getStepX() + dy * dir.getStepY() + dz * dir.getStepZ();
            if (dot > bestDot) {
                bestDot = dot;
                best = dir;
            }
        }
        return best;
    }

    private void executeCommand(BotHandle bot, String command) {
        ServerPlayer player = bot.getNativePlayer();
        if (player != null && player.server != null) {
            player.server.getCommands().performPrefixedCommand(
                    player.server.createCommandSourceStack(), command);
        }
    }

    @Override
    protected boolean isEqual(Task other) {
        if (other instanceof PlaceBlockTask task) {
            return task.targetPos.equals(targetPos) && task.blockToPlace == blockToPlace;
        }
        return false;
    }

    @Override
    protected String toDebugString() {
        return "Place(" + blockToPlace.getDescriptionId() + ")";
    }
}