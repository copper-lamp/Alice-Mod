package io.alice.mod.adapter.ai.behavior.task;

import io.alice.mod.adapter.ai.BotAccess;
import io.alice.mod.adapter.ai.behavior.ITaskRequiresGrounded;
import io.alice.mod.adapter.ai.behavior.Task;
import io.alice.mod.adapter.api.service.BotHandle;
import io.alice.mod.adapter.api.service.PathfindingService;
import io.alice.mod.adapter.api.types.PathConstraints;
import io.alice.mod.adapter.api.types.PathResult;
import io.alice.mod.adapter.api.types.Vec3;
import io.alice.mod.adapter.ai.action.ActionController;
import io.alice.mod.adapter.ai.state.MovementExecutor;
import net.minecraft.server.level.ServerPlayer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.Optional;

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
    private boolean pathApplied = false;

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
        pathApplied = false;
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
            if (executor != null) executor.stop(bot);
            setDebugState("Arrived");
            return null;
        }

        // 如果执行器正在运行，继续执行移动
        if (executor != null && executor.isRunning()) {
            executor.continueTick(bot);
            setDebugState("Moving...");
            return null;
        }

        // 如果执行器已完成，但还没到达（路径耗尽），重新规划
        if (executor != null && executor.isFinished() && !isFinished(bot)) {
            LOG.debug("MoveToTask: path exhausted, replanning...");
            pathfinding = false;
            pathApplied = false;
            executor.reset();
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
        if (pathfinding && !pathApplied
                && System.currentTimeMillis() - pathfindStartTime > PATHFIND_TIMEOUT) {
            LOG.warn("MoveToTask: pathfind timeout, retry {}/{}", retryCount + 1, MAX_RETRIES);
            pathfinding = false;
            retryCount++;
            if (retryCount >= MAX_RETRIES) {
                setDebugState("Pathfind failed");
                if (allowWander) {
                    LOG.debug("MoveToTask: fallback to wander");
                    return new TimeoutWanderTask(10);
                }
                return null;
            }
            // 重试
            startPathfinding(bot);
            return null;
        }

        // 路径规划完成，应用路径
        if (pathfinding && !pathApplied) {
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
        PathfindingService pathfinding = BotAccess.getPathfindingService();
        if (pathfinding == null) {
            LOG.warn("MoveToTask: PathfindingService not available");
            initialPathFailed = true;
            return;
        }

        Vec3 currentPos = bot.position();
        String dimension = bot.dimension();

        try {
            Optional<PathResult> result = pathfinding.findPath(currentPos, destination, dimension, constraints);
            if (result.isPresent()) {
                PathResult path = result.get();
                LOG.debug("MoveToTask: path found with {} waypoints", path.points().size());

                // 将路径应用到执行器
                if (executor != null) {
                    executor.start(bot, path, destination);
                    pathApplied = true;
                    initialPathFailed = false;
                }
            } else {
                LOG.warn("MoveToTask: no path found from {} to {}", currentPos, destination);
                initialPathFailed = true;
            }
        } catch (Exception e) {
            LOG.error("MoveToTask: pathfinding error", e);
            initialPathFailed = true;
        }
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

    // ──────────────────────────────────────────────
    //  查询
    // ──────────────────────────────────────────────

    public MovementExecutor getExecutor() {
        return executor;
    }
}