package io.alice.mod.adapter.ai.behavior.task;

import io.alice.mod.adapter.ai.behavior.ITaskRequiresGrounded;
import io.alice.mod.adapter.ai.behavior.Task;
import io.alice.mod.adapter.api.service.BotHandle;
import io.alice.mod.adapter.api.types.PathConstraints;
import io.alice.mod.adapter.api.types.Vec3;
import io.alice.mod.adapter.ai.action.ActionController;
import io.alice.mod.adapter.ai.state.MovementExecutor;
import net.minecraft.server.level.ServerPlayer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * 移动到指定位置的任务。
 * <p>
 * 从 altoclef {@code adris.altoclef.tasks.movement.CustomBaritoneGoalTask} 移植。
 * <p>
 * 使用 {@link MovementExecutor} 执行移动，无 Baritone 依赖。
 * 实现 {@link ITaskRequiresGrounded}，在空中跑酷时不会被中断。
 */
public class MoveToTask extends Task implements ITaskRequiresGrounded {

    private static final Logger LOG = LoggerFactory.getLogger(MoveToTask.class);

    // ──────────────────────────────────────────────
    //  常量
    // ──────────────────────────────────────────────

    /** 到达目标的精度（方块）。 */
    private static final double ARRIVAL_THRESHOLD = 1.5;
    /** 最大重试次数。 */
    private static final int MAX_RETRIES = 3;
    /** 路径规划超时（ms）。 */
    private static final long PATHFIND_TIMEOUT = 5000;

    // ──────────────────────────────────────────────
    //  状态
    // ──────────────────────────────────────────────

    private final Vec3 destination;
    private final PathConstraints constraints;
    private final boolean allowWander;
    private int retryCount = 0;
    private long pathfindStartTime = 0;
    private boolean pathfinding = false;
    private MovementExecutor executor;
    private boolean initialPathFailed = false;

    // ──────────────────────────────────────────────
    //  构造
    // ──────────────────────────────────────────────

    public MoveToTask(Vec3 destination) {
        this(destination, PathConstraints.DEFAULT, true);
    }

    public MoveToTask(Vec3 destination, PathConstraints constraints, boolean allowWander) {
        this.destination = destination;
        this.constraints = constraints;
        this.allowWander = allowWander;
        setDebugState("MoveTo(" + destination.x() + "," + destination.y() + "," + destination.z() + ")");
    }

    // ──────────────────────────────────────────────
    //  生命周期
    // ──────────────────────────────────────────────

    @Override
    protected void onStart(BotHandle bot) {
        retryCount = 0;
        pathfinding = false;
        initialPathFailed = false;
        executor = new MovementExecutor(new ActionController());
        executor.reset();
        LOG.debug("MoveToTask: start -> {}", destination);
    }

    @Override
    protected Task onTick(BotHandle bot) {
        ServerPlayer player = bot.getNativePlayer();
        if (player == null) {
            setDebugState("No player");
            return null;
        }

        // 检查是否到达
        if (isFinished(bot)) {
            executor.stop(bot);
            setDebugState("Arrived");
            return null;
        }

        // 路径规划
        if (!pathfinding) {
            startPathfinding(bot);
            pathfinding = true;
            pathfindStartTime = System.currentTimeMillis();
            setDebugState("Pathfinding...");
            return null;
        }

        // 路径规划超时
        if (pathfinding && System.currentTimeMillis() - pathfindStartTime > PATHFIND_TIMEOUT) {
            LOG.warn("MoveToTask: pathfind timeout, retry {}/{}", retryCount + 1, MAX_RETRIES);
            pathfinding = false;
            retryCount++;
            if (retryCount >= MAX_RETRIES) {
                setDebugState("Pathfind failed");
                if (allowWander) {
                    // 兜底：使用游荡任务
                    LOG.debug("MoveToTask: fallback to wander");
                    return new TimeoutWanderTask(10);
                }
                return null;
            }
            // 重试
            startPathfinding(bot);
            return null;
        }

        // 执行移动
        if (executor.isRunning()) {
            executor.continueTick(bot);
            setDebugState("Moving to destination");
            return null;
        }

        // 路径规划完成但执行器未启动
        if (pathfinding) {
            applyPathResult(bot);
        }

        return null;
    }

    @Override
    protected void onStop(BotHandle bot, Task interruptTask) {
        if (executor != null) {
            executor.stop(bot);
        }
        LOG.debug("MoveToTask: stopped");
    }

    @Override
    public boolean isFinished(BotHandle bot) {
        Vec3 currentPos = bot.position();
        boolean arrived = currentPos.distanceTo(destination) < ARRIVAL_THRESHOLD;

        // 检查垂直距离
        if (arrived) {
            double verticalDiff = Math.abs(currentPos.y() - destination.y());
            return verticalDiff < 3.0;
        }
        return false;
    }

    // ──────────────────────────────────────────────
    //  路径规划
    // ──────────────────────────────────────────────

    private void startPathfinding(BotHandle bot) {
        // TODO: 集成 PathfindingService 进行异步路径规划
        // 当前 PathfindingService 为桩实现（stub），暂时标记为路径规划失败
        initialPathFailed = true;
    }

    private void applyPathResult(BotHandle bot) {
        // 如果路径规划失败，尝试游荡
        if (initialPathFailed) {
            if (allowWander) {
                LOG.debug("MoveToTask: path failed, wander");
                // 切换到游荡任务
            } else {
                setDebugState("No path found");
            }
        }
    }

    @Override
    protected boolean isEqual(Task other) {
        if (other instanceof MoveToTask task) {
            return task.destination.equals(destination);
        }
        return false;
    }

    @Override
    protected String toDebugString() {
        return "MoveTo(" + destination.x() + "," + destination.y() + "," + destination.z() + ")";
    }
}