package io.alice.mod.adapter.ai.behavior.task;

import io.alice.mod.adapter.ai.behavior.ITaskRequiresGrounded;
import io.alice.mod.adapter.ai.behavior.Task;
import io.alice.mod.adapter.api.service.BotHandle;
import io.alice.mod.adapter.api.types.Vec3;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.item.SwordItem;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * 攻击实体任务——自动追踪并攻击目标实体。
 * <p>
 * 从 altoclef 概念移植。
 * <p>
 * 实现 {@link ITaskRequiresGrounded}，需要落地才能中断。
 */
public class AttackEntityTask extends Task implements ITaskRequiresGrounded {

    private static final Logger LOG = LoggerFactory.getLogger(AttackEntityTask.class);

    // ──────────────────────────────────────────────
    //  常量
    // ──────────────────────────────────────────────

    /** 攻击范围（方块）。 */
    private static final double ATTACK_RANGE = 4.0;
    /** 攻击间隔（ms）。 */
    private static final long ATTACK_INTERVAL_MS = 500;
    /** 追踪距离（方块内开始攻击）。 */
    private static final double TRACK_RANGE = 20.0;

    // ──────────────────────────────────────────────
    //  状态
    // ──────────────────────────────────────────────

    private final Entity target;
    private long lastAttackTime = 0;

    // ──────────────────────────────────────────────
    //  构造
    // ──────────────────────────────────────────────

    public AttackEntityTask(Entity target) {
        this.target = target;
        setDebugState("Attack(" + target.getDisplayName().getString() + ")");
    }

    // ──────────────────────────────────────────────
    //  生命周期
    // ──────────────────────────────────────────────

    @Override
    protected void onStart(BotHandle bot) {
        lastAttackTime = 0;
        LOG.debug("AttackEntityTask: start attacking {}", target.getDisplayName().getString());
    }

    @Override
    protected Task onTick(BotHandle bot) {
        ServerPlayer player = bot.getNativePlayer();
        if (player == null) return null;

        // 检查目标是否还活着
        if (!target.isAlive()) {
            setDebugState("Target dead");
            return null;
        }

        // 计算距离
        double dist = Math.sqrt(player.distanceToSqr(target));

        // 如果目标太远，先追踪
        if (dist > TRACK_RANGE) {
            setDebugState("Target lost");
            return null;
        }

        // 如果目标在范围内，攻击
        if (dist <= ATTACK_RANGE) {
            // 面向目标
            float[] angles = calculateLookAngles(player, target);
            String lookCmd = String.format("player %s lookAt %.2f %.2f %.2f",
                    bot.name(),
                    target.getX(),
                    target.getY() + target.getBbHeight() * 0.5,
                    target.getZ());
            executeCommand(bot, lookCmd);

            // 攻击
            long now = System.currentTimeMillis();
            if (now - lastAttackTime > ATTACK_INTERVAL_MS) {
                String attackCmd = String.format("player %s attack", bot.name());
                executeCommand(bot, attackCmd);
                lastAttackTime = now;
                setDebugState("Attacking " + target.getDisplayName().getString());
            }
        } else {
            // 追踪目标
            setDebugState("Chasing " + target.getDisplayName().getString());
            return new MoveToTask(Vec3.of(
                    target.getX(),
                    target.getY(),
                    target.getZ()
            ));
        }

        return null;
    }

    @Override
    protected void onStop(BotHandle bot, Task interruptTask) {
        String stopCmd = String.format("player %s attack stop", bot.name());
        executeCommand(bot, stopCmd);
        LOG.debug("AttackEntityTask: stopped");
    }

    @Override
    public boolean isFinished(BotHandle bot) {
        return !target.isAlive() || target.isRemoved();
    }

    // ──────────────────────────────────────────────
    //  内部方法
    // ──────────────────────────────────────────────

    private float[] calculateLookAngles(ServerPlayer player, Entity target) {
        double dx = target.getX() - player.getX();
        double dy = target.getY() + target.getBbHeight() * 0.5 - (player.getY() + 1.62);
        double dz = target.getZ() - player.getZ();
        double dist = Math.sqrt(dx * dx + dz * dz);

        float yaw = (float) Math.toDegrees(Math.atan2(-dx, dz));
        float pitch = (float) -Math.toDegrees(Math.atan2(dy, Math.max(dist, 0.01)));

        return new float[]{yaw, pitch};
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
        if (other instanceof AttackEntityTask task) {
            return task.target == target;
        }
        return false;
    }

    @Override
    protected String toDebugString() {
        return "Attack(" + target.getDisplayName().getString() + ")";
    }
}