package io.alice.mod.adapter.ai.behavior.task;

import io.alice.mod.adapter.ai.behavior.ITaskRequiresGrounded;
import io.alice.mod.adapter.ai.behavior.Task;
import io.alice.mod.adapter.api.service.BotHandle;
import io.alice.mod.adapter.api.types.Vec3;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.Entity;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * 跟随实体任务——持续追踪目标实体并保持距离。
 * <p>
 * 从 altoclef 概念移植。
 * <p>
 * 实现 {@link ITaskRequiresGrounded}，需要落地才能中断。
 */
public class FollowEntityTask extends Task implements ITaskRequiresGrounded {

    private static final Logger LOG = LoggerFactory.getLogger(FollowEntityTask.class);

    // ──────────────────────────────────────────────
    //  常量
    // ──────────────────────────────────────────────

    /** 跟随距离（方块）。 */
    private static final double FOLLOW_DISTANCE = 3.0;
    /** 最大跟随距离（方块，超出放弃）。 */
    private static final double MAX_FOLLOW_DISTANCE = 64.0;

    // ──────────────────────────────────────────────
    //  状态
    // ──────────────────────────────────────────────

    private final Entity target;
    private final double followDistance;

    // ──────────────────────────────────────────────
    //  构造
    // ──────────────────────────────────────────────

    public FollowEntityTask(Entity target) {
        this(target, FOLLOW_DISTANCE);
    }

    public FollowEntityTask(Entity target, double followDistance) {
        this.target = target;
        this.followDistance = followDistance;
        setDebugState("Follow(" + target.getDisplayName().getString() + ")");
    }

    // ──────────────────────────────────────────────
    //  生命周期
    // ──────────────────────────────────────────────

    @Override
    protected void onStart(BotHandle bot) {
        LOG.debug("FollowEntityTask: start following {}", target.getDisplayName().getString());
    }

    @Override
    protected Task onTick(BotHandle bot) {
        ServerPlayer player = bot.getNativePlayer();
        if (player == null) return null;

        // 检查目标是否存在
        if (!target.isAlive() || target.isRemoved()) {
            setDebugState("Target lost");
            return null;
        }

        // 计算距离
        double dist = Math.sqrt(player.distanceToSqr(target));

        // 超出最大距离
        if (dist > MAX_FOLLOW_DISTANCE) {
            setDebugState("Target too far");
            return null;
        }

        // 在跟随距离内，停止移动
        if (dist <= followDistance) {
            setDebugState("Following (" + String.format("%.1f", dist) + "m)");
            // 面向目标
            String lookCmd = String.format("player %s lookAt %.2f %.2f %.2f",
                    bot.name(),
                    target.getX(),
                    target.getY() + target.getBbHeight() * 0.5,
                    target.getZ());
            executeCommand(bot, lookCmd);
            return null;
        }

        // 追踪目标
        setDebugState("Chasing " + target.getDisplayName().getString());
        return new MoveToTask(Vec3.of(
                target.getX(),
                target.getY(),
                target.getZ()
        ));
    }

    @Override
    protected void onStop(BotHandle bot, Task interruptTask) {
        LOG.debug("FollowEntityTask: stopped");
    }

    @Override
    public boolean isFinished(BotHandle bot) {
        return !target.isAlive() || target.isRemoved();
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
        if (other instanceof FollowEntityTask task) {
            return task.target == target;
        }
        return false;
    }

    @Override
    protected String toDebugString() {
        return "Follow(" + target.getDisplayName().getString() + ")";
    }
}