package io.alice.mod.adapter.ai.behavior.task;

import io.alice.mod.adapter.ai.behavior.ITaskOverridesGrounded;
import io.alice.mod.adapter.ai.behavior.Task;
import io.alice.mod.adapter.api.service.BotHandle;
import io.alice.mod.adapter.api.types.Vec3;
import net.minecraft.core.BlockPos;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.level.block.BedBlock;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.state.BlockState;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * 睡觉任务——找到床并睡觉。
 * <p>
 * 从 altoclef 概念移植。
 * <p>
 * 实现 {@link ITaskOverridesGrounded}，空中也可以睡觉。
 */
public class SleepTask extends Task implements ITaskOverridesGrounded {

    private static final Logger LOG = LoggerFactory.getLogger(SleepTask.class);

    // ──────────────────────────────────────────────
    //  常量
    // ──────────────────────────────────────────────

    /** 床的搜索半径。 */
    private static final int BED_SEARCH_RADIUS = 32;

    // ──────────────────────────────────────────────
    //  状态
    // ──────────────────────────────────────────────

    private BlockPos bedPos;
    private boolean bedFound = false;
    private boolean searched = false;

    public SleepTask() {
        setDebugState("Sleep");
    }

    // ──────────────────────────────────────────────
    //  生命周期
    // ──────────────────────────────────────────────

    @Override
    protected void onStart(BotHandle bot) {
        bedPos = null;
        bedFound = false;
        searched = false;
        LOG.debug("SleepTask: start");
    }

    @Override
    protected Task onTick(BotHandle bot) {
        ServerPlayer player = bot.getNativePlayer();
        if (player == null) return null;

        // 检查是否已经在睡觉
        if (player.isSleeping()) {
            setDebugState("Sleeping...");
            return null;
        }

        // 检查是否白天（不需要睡觉）
        long time = player.serverLevel().getDayTime() % 24000;
        if (time < 12541 || time > 23458) {
            setDebugState("Not night time");
            return null;
        }

        // 搜索床
        if (!searched) {
            bedPos = findBed(player);
            searched = true;
            if (bedPos != null) {
                bedFound = true;
                LOG.debug("SleepTask: found bed at {}", bedPos);
            }
        }

        // 没找到床
        if (!bedFound) {
            setDebugState("No bed found");
            return null;
        }

        // 移动到床
        double dist = Math.sqrt(player.distanceToSqr(
                bedPos.getX(), bedPos.getY(), bedPos.getZ()));
        if (dist > 2.5) {
            setDebugState("Moving to bed");
            return new MoveToTask(Vec3.of(
                    bedPos.getX() + 0.5,
                    bedPos.getY(),
                    bedPos.getZ() + 0.5
            ));
        }

        // 右键床
        String useCmd = String.format("player %s useItem", bot.name());
        executeCommand(bot, useCmd);

        setDebugState("Trying to sleep");
        return null;
    }

    @Override
    protected void onStop(BotHandle bot, Task interruptTask) {
        LOG.debug("SleepTask: stopped");
    }

    @Override
    public boolean isFinished(BotHandle bot) {
        ServerPlayer player = bot.getNativePlayer();
        if (player == null) return true;
        // 一觉醒来就完成
        return player.isSleeping() && player.getSleepTimer() > 100;
    }

    // ──────────────────────────────────────────────
    //  内部方法
    // ──────────────────────────────────────────────

    private BlockPos findBed(ServerPlayer player) {
        BlockPos center = player.blockPosition();
        for (int x = -BED_SEARCH_RADIUS; x <= BED_SEARCH_RADIUS; x++) {
            for (int z = -BED_SEARCH_RADIUS; z <= BED_SEARCH_RADIUS; z++) {
                for (int y = -4; y <= 4; y++) {
                    BlockPos pos = center.offset(x, y, z);
                    BlockState state = player.serverLevel().getBlockState(pos);
                    if (state.getBlock() instanceof BedBlock) {
                        return pos;
                    }
                }
            }
        }
        return null;
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
        return other instanceof SleepTask;
    }

    @Override
    protected String toDebugString() {
        return "Sleep";
    }
}