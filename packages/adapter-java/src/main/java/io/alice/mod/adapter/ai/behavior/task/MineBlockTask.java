package io.alice.mod.adapter.ai.behavior.task;

import io.alice.mod.adapter.ai.behavior.ITaskRequiresGrounded;
import io.alice.mod.adapter.ai.behavior.Task;
import io.alice.mod.adapter.api.service.BotHandle;
import io.alice.mod.adapter.api.types.Vec3;
import net.minecraft.core.BlockPos;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.item.PickaxeItem;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.state.BlockState;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * 挖掘方块任务。
 * <p>
 * 从 altoclef {@code adris.altoclef.tasks.construction.DestroyBlockTask} 移植。
 * <p>
 * 实现 {@link ITaskRequiresGrounded}，需要落地才能中断。
 * 使用 Carpet 命令模拟玩家挖掘。
 */
public class MineBlockTask extends Task implements ITaskRequiresGrounded {

    private static final Logger LOG = LoggerFactory.getLogger(MineBlockTask.class);

    // ──────────────────────────────────────────────
    //  常量
    // ──────────────────────────────────────────────

    /** 挖掘超时（tick）。 */
    private static final int MINE_TIMEOUT_TICKS = 200; // 10 秒
    /** 挖掘距离（方块内）。 */
    private static final double MINE_RANGE = 5.0;
    /** 挖掘间隔（ms）。 */
    private static final long MINE_INTERVAL_MS = 500;

    // ──────────────────────────────────────────────
    //  状态
    // ──────────────────────────────────────────────

    private final BlockPos targetPos;
    private final Block targetBlock;
    private int tickCount = 0;
    private long lastMineTime = 0;
    private boolean miningStarted = false;

    // ──────────────────────────────────────────────
    //  构造
    // ──────────────────────────────────────────────

    public MineBlockTask(BlockPos pos) {
        this.targetPos = pos;
        this.targetBlock = null;
        setDebugState("Mine(" + pos.getX() + "," + pos.getY() + "," + pos.getZ() + ")");
    }

    public MineBlockTask(BlockPos pos, Block block) {
        this.targetPos = pos;
        this.targetBlock = block;
        setDebugState("Mine(" + block.getDescriptionId() + ")");
    }

    // ──────────────────────────────────────────────
    //  生命周期
    // ──────────────────────────────────────────────

    @Override
    protected void onStart(BotHandle bot) {
        tickCount = 0;
        miningStarted = false;
        lastMineTime = 0;

        // 确保在范围内
        ServerPlayer player = bot.getNativePlayer();
        if (player == null) return;

        double dist = Math.sqrt(player.distanceToSqr(
                targetPos.getX(), targetPos.getY(), targetPos.getZ()));
        if (dist > MINE_RANGE) {
            LOG.debug("MineBlockTask: target out of range ({:.1f} > {:.1f}), will move first", dist, MINE_RANGE);
        }

        LOG.debug("MineBlockTask: start mining at {}", targetPos);
    }

    @Override
    protected Task onTick(BotHandle bot) {
        ServerPlayer player = bot.getNativePlayer();
        if (player == null) return null;

        tickCount++;

        // 超时检查
        if (tickCount > MINE_TIMEOUT_TICKS) {
            LOG.warn("MineBlockTask: timeout mining at {}", targetPos);
            setDebugState("Mine timeout");
            return null;
        }

        // 检查方块是否已被破坏
        BlockState state = player.serverLevel().getBlockState(targetPos);
        if (state.isAir()) {
            setDebugState("Block mined");
            LOG.debug("MineBlockTask: block mined at {}", targetPos);
            return null;
        }

        // 检查是否在范围内
        double dist = Math.sqrt(player.distanceToSqr(
                targetPos.getX(), targetPos.getY(), targetPos.getZ()));
        if (dist > MINE_RANGE) {
            setDebugState("Moving closer to mine");
            // 先移动到目标附近
            return new MoveToTask(Vec3.of(
                    targetPos.getX() + 0.5,
                    targetPos.getY(),
                    targetPos.getZ() + 0.5
            ));
        }

        // 面向目标方块
        String lookCmd = String.format("player %s lookAt %.2f %.2f %.2f",
                bot.name(),
                targetPos.getX() + 0.5,
                targetPos.getY() + 0.5,
                targetPos.getZ() + 0.5);
        executeCommand(bot, lookCmd);

        // 装备最佳工具
        equipBestTool(bot, player, state);

        // 挖掘（间隔控制）
        long now = System.currentTimeMillis();
        if (now - lastMineTime > MINE_INTERVAL_MS) {
            String attackCmd = String.format("player %s attack", bot.name());
            executeCommand(bot, attackCmd);
            lastMineTime = now;
            miningStarted = true;
            setDebugState("Mining...");
        }

        return null;
    }

    @Override
    protected void onStop(BotHandle bot, Task interruptTask) {
        // 停止攻击
        String stopCmd = String.format("player %s attack stop", bot.name());
        executeCommand(bot, stopCmd);
        LOG.debug("MineBlockTask: stopped");
    }

    @Override
    public boolean isFinished(BotHandle bot) {
        ServerPlayer player = bot.getNativePlayer();
        if (player == null) return true;
        BlockState state = player.serverLevel().getBlockState(targetPos);
        return state.isAir();
    }

    // ──────────────────────────────────────────────
    //  工具方法
    // ──────────────────────────────────────────────

    private void equipBestTool(BotHandle bot, ServerPlayer player, BlockState state) {
        // 简化版：检查背包中的最佳工具并装备
        // TODO: 使用 InventoryService 实现更完善的工具选择
        String equipCmd = String.format("player %s equip hotbar 0", bot.name());
        executeCommand(bot, equipCmd);
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
        if (other instanceof MineBlockTask task) {
            return task.targetPos.equals(targetPos);
        }
        return false;
    }

    @Override
    protected String toDebugString() {
        return "Mine(" + targetPos.getX() + "," + targetPos.getY() + "," + targetPos.getZ() + ")";
    }
}