package io.alice.mod.adapter.ai.behavior.task;

import io.alice.mod.adapter.ai.behavior.ITaskRequiresGrounded;
import io.alice.mod.adapter.ai.behavior.Task;
import io.alice.mod.adapter.api.service.BotHandle;
import io.alice.mod.adapter.api.types.Vec3;
import net.minecraft.core.BlockPos;
import net.minecraft.server.level.ServerPlayer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * 与方块交互任务（右键方块）。
 * <p>
 * 用于打开箱子、熔炉、工作台等。
 * <p>
 * 实现 {@link ITaskRequiresGrounded}，需要落地才能中断。
 */
public class InteractBlockTask extends Task implements ITaskRequiresGrounded {

    private static final Logger LOG = LoggerFactory.getLogger(InteractBlockTask.class);

    // ──────────────────────────────────────────────
    //  常量
    // ──────────────────────────────────────────────

    /** 交互距离（方块）。 */
    private static final double INTERACT_RANGE = 5.0;

    // ──────────────────────────────────────────────
    //  状态
    // ──────────────────────────────────────────────

    private final BlockPos targetPos;
    private boolean interacted = false;

    // ──────────────────────────────────────────────
    //  构造
    // ──────────────────────────────────────────────

    public InteractBlockTask(BlockPos pos) {
        this.targetPos = pos;
        setDebugState("Interact(" + pos.getX() + "," + pos.getY() + "," + pos.getZ() + ")");
    }

    // ──────────────────────────────────────────────
    //  生命周期
    // ──────────────────────────────────────────────

    @Override
    protected void onStart(BotHandle bot) {
        interacted = false;
        LOG.debug("InteractBlockTask: start interact at {}", targetPos);
    }

    @Override
    protected Task onTick(BotHandle bot) {
        ServerPlayer player = bot.getNativePlayer();
        if (player == null) return null;

        // 检查是否在范围内
        double dist = Math.sqrt(player.distanceToSqr(
                targetPos.getX(), targetPos.getY(), targetPos.getZ()));
        if (dist > INTERACT_RANGE) {
            setDebugState("Moving closer");
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

        // 右键交互
        String useCmd = String.format("player %s useItem", bot.name());
        executeCommand(bot, useCmd);
        interacted = true;

        setDebugState("Interacting...");
        return null;
    }

    @Override
    protected void onStop(BotHandle bot, Task interruptTask) {
        String stopCmd = String.format("player %s useItem stop", bot.name());
        executeCommand(bot, stopCmd);
        LOG.debug("InteractBlockTask: stopped");
    }

    @Override
    public boolean isFinished(BotHandle bot) {
        return interacted;
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
        if (other instanceof InteractBlockTask task) {
            return task.targetPos.equals(targetPos);
        }
        return false;
    }

    @Override
    protected String toDebugString() {
        return "Interact(" + targetPos.getX() + "," + targetPos.getY() + "," + targetPos.getZ() + ")";
    }
}