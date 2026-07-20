package io.alice.mod.adapter.ai.state;

import io.alice.mod.adapter.ai.action.ActionController;
import io.alice.mod.adapter.ai.state.SmoothInputController.Input;
import io.alice.mod.adapter.api.service.BotHandle;
import io.alice.mod.adapter.api.types.PathResult;
import io.alice.mod.adapter.api.types.Vec3;
import net.minecraft.server.level.ServerPlayer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.List;

/**
 * 移动执行器——整合所有移动相关组件。
 * <p>
 * 职责：
 * <ul>
 *   <li>接收 PathResult 并分解为路径段</li>
 *   <li>每 tick 协调 MovementStateMachine、SmoothLookController、SmoothMovementController、SmoothInputController</li>
 *   <li>管理是否到达目标点</li>
 *   <li>处理中断和恢复</li>
 * </ul>
 * <p>
 * 执行流程（每 tick）：
 * <pre>
 * 1. MovementStateMachine.autoTransition() — 环境自动转换
 * 2. 获取当前路径段的目标点
 * 3. SmoothLookController.setTarget() — 看向目标点
 * 4. SmoothLookController.update() — 更新视角
 * 5. 计算移动方向
 * 6. SmoothMovementController.calculateVelocity() — 计算速度
 * 7. SmoothInputController 安排输入
 * 8. SmoothInputController.processInputQueue() — 处理输入队列
 * 9. 检查是否到达目标点
 * </pre>
 */
public class MovementExecutor {

    private static final Logger LOG = LoggerFactory.getLogger(MovementExecutor.class);

    // ──────────────────────────────────────────────
    //  常量
    // ──────────────────────────────────────────────

    /** 到达 Waypoint 的精度（方块）。 */
    private static final double WAYPOINT_REACH_THRESHOLD = 1.0;
    /** 到达最终目标的精度（方块）。 */
    private static final double FINAL_REACH_THRESHOLD = 1.5;
    /** 停止时视角稳定等待时间（tick）。 */
    private static final int STABLE_WAIT_TICKS = 5;

    // ──────────────────────────────────────────────
    //  子组件
    // ──────────────────────────────────────────────

    private final MovementStateMachine stateMachine;
    private final SmoothLookController lookController;
    private final SmoothMovementController movementController;
    private final SmoothInputController inputController;
    private final ActionController actionController;
    private final MovementContext context;

    // ──────────────────────────────────────────────
    //  执行状态
    // ──────────────────────────────────────────────

    private List<Vec3> pathPoints = null;
    private int currentSegmentIndex = 0;
    private Vec3 finalDestination = null;
    private boolean running = false;
    private boolean finished = false;
    private Vec3 lastPosition = null;
    private int stableTicks = 0;

    public MovementExecutor(ActionController actionController) {
        this.stateMachine = new MovementStateMachine();
        this.lookController = new SmoothLookController();
        this.movementController = new SmoothMovementController();
        this.inputController = new SmoothInputController();
        this.actionController = actionController;
        this.context = new MovementContext();
    }

    // ──────────────────────────────────────────────
    //  公开接口
    // ──────────────────────────────────────────────

    /**
     * 开始执行移动。
     *
     * @param bot     假人句柄
     * @param path    路径结果
     * @param dest    最终目标位置
     */
    public void start(BotHandle bot, PathResult path, Vec3 dest) {
        this.pathPoints = path.points();
        this.finalDestination = dest;
        this.currentSegmentIndex = 0;
        this.running = true;
        this.finished = false;
        this.lastPosition = bot.position();
        this.stableTicks = 0;

        // 复位所有子组件
        stateMachine.reset();
        lookController.reset();
        movementController.reset();
        inputController.reset();
        context.reset();
        context.setFinalDestination(dest);

        LOG.debug("MovementExecutor: started path with {} segments to {}", pathPoints.size(), dest);
    }

    /**
     * 每 tick 调用，继续执行移动。
     *
     * @param bot 假人句柄
     */
    public void continueTick(BotHandle bot) {
        if (!running || finished) return;

        // 1. 更新环境上下文
        updateContext(bot);

        // 2. 自动状态转换（环境检测：游泳/攀爬等）
        stateMachine.autoTransition(bot);

        // 3. 获取当前路径段目标点
        Vec3 target = getCurrentTarget();
        if (target == null) {
            // 没有路径点，直接看向最终目标
            target = finalDestination;
        }

        // 4. 更新视角控制
        updateLook(bot, target);

        // 5. 计算移动方向
        Vec3 currentPos = bot.position();
        Vec3 direction = calculateDirection(currentPos, target);
        boolean isTurning = isTurningDirection(currentPos, target);

        // 6. 检查是否到达
        if (checkArrival(bot, currentPos, target)) {
            advanceSegment(bot);
            return;
        }

        // 7. 更新移动控制
        MoveMode mode = stateMachine.getState();
        Vec3 velocity = movementController.calculateVelocity(direction, mode, isTurning, false);

        // 8. 应用移动输入
        applyMovementInputs(bot, mode, velocity);

        // 9. 处理输入队列
        inputController.processInputQueue(bot);

        // 更新上下文
        context.setCurrentWaypoint(target);
        context.setMoveDirection(direction);
        context.setMoveMode(mode);
        context.setTurning(isTurning);
        context.setDistanceToDestination(currentPos.distanceTo(finalDestination));
        context.setSegmentIndex(currentSegmentIndex);

        lastPosition = currentPos;
    }

    /**
     * 停止移动。
     */
    public void stop(BotHandle bot) {
        if (!running) return;

        // 减速停止
        for (int i = 0; i < 10; i++) {
            movementController.calculateVelocity(null, stateMachine.getState(), false, true);
        }

        // 停止所有输入和动作
        inputController.releaseAll(bot);
        inputController.processInputQueue(bot);
        actionController.stopAll(bot);

        running = false;
        finished = true;
        LOG.debug("MovementExecutor: stopped");
    }

    // ──────────────────────────────────────────────
    //  内部方法
    // ──────────────────────────────────────────────

    /**
     * 更新环境上下文。
     */
    private void updateContext(BotHandle bot) {
        ServerPlayer player = bot.getNativePlayer();
        if (player == null) return;

        context.setOnGround(player.onGround());
        context.setInWater(player.isTouchingWater());
        context.setOnLadder(player.isClimbing());
        context.setInLava(player.isInLava());
        context.setOnFire(player.isOnFire());
        context.setFoodLevel(bot.foodLevel());
        context.setHealth(bot.health());
    }

    /**
     * 更新视角：平滑看向目标点。
     */
    private void updateLook(BotHandle bot, Vec3 target) {
        Vec3 currentPos = bot.position();
        float[] angles = calculateLookAngles(currentPos, target);

        // 挖掘/放置时使用更高的精度
        MoveMode mode = stateMachine.getState();
        if (mode == MoveMode.BREAK_BLOCK || mode == MoveMode.PLACE_BLOCK) {
            lookController.snapTo(angles[0], angles[1]);
        } else {
            lookController.setTarget(angles[0], angles[1]);
        }

        lookController.update(bot);
    }

    /**
     * 计算从当前位置看向目标点的视角。
     *
     * @return [yaw, pitch]
     */
    private float[] calculateLookAngles(Vec3 from, Vec3 to) {
        double dx = to.x() - from.x();
        double dy = to.y() - (from.y() + 1.62); // 眼睛高度
        double dz = to.z() - from.z();
        double dist = Math.sqrt(dx * dx + dz * dz);

        float yaw = (float) Math.toDegrees(Math.atan2(-dx, dz));
        float pitch = (float) -Math.toDegrees(Math.atan2(dy, Math.max(dist, 0.01)));

        return new float[]{yaw, pitch};
    }

    /**
     * 计算移动方向向量。
     */
    private Vec3 calculateDirection(Vec3 from, Vec3 to) {
        double dx = to.x() - from.x();
        double dy = to.y() - from.y();
        double dz = to.z() - from.z();

        // 只使用水平方向移动
        double len = Math.sqrt(dx * dx + dz * dz);
        if (len < 0.01) {
            return Vec3.of(0, 0, 0);
        }
        return Vec3.of(dx / len, 0, dz / len);
    }

    /**
     * 判断是否正在转向。
     */
    private boolean isTurningDirection(Vec3 from, Vec3 to) {
        // 计算当前方向与目标方向的夹角
        Vec3 currentDir = context.getMoveDirection();
        Vec3 targetDir = calculateDirection(from, to);

        double dot = currentDir.x() * targetDir.x() + currentDir.z() * targetDir.z();
        return dot < 0.9; // 夹角 > 25° 视为转向
    }

    /**
     * 获取当前路径段的目标点。
     */
    private Vec3 getCurrentTarget() {
        if (pathPoints == null || pathPoints.isEmpty()) {
            return null;
        }
        if (currentSegmentIndex >= pathPoints.size()) {
            return null;
        }
        return pathPoints.get(currentSegmentIndex);
    }

    /**
     * 检查是否到达目标点。
     */
    private boolean checkArrival(BotHandle bot, Vec3 currentPos, Vec3 target) {
        double threshold = (target == finalDestination) ? FINAL_REACH_THRESHOLD : WAYPOINT_REACH_THRESHOLD;

        if (currentPos.horizontalDistanceTo(target) < threshold) {
            // 检查垂直距离
            double verticalDiff = Math.abs(currentPos.y() - target.y());
            if (verticalDiff < 3.0) {
                stableTicks++;
                if (stableTicks >= STABLE_WAIT_TICKS) {
                    return true;
                }
            }
        } else {
            stableTicks = 0;
        }
        return false;
    }

    /**
     * 前进到下一个路径段。
     */
    private void advanceSegment(BotHandle bot) {
        currentSegmentIndex++;
        stableTicks = 0;

        if (currentSegmentIndex >= pathPoints.size()) {
            // 所有路径段完成
            if (finalDestination != null) {
                // 检查最终目标
                Vec3 currentPos = bot.position();
                if (currentPos.horizontalDistanceTo(finalDestination) < FINAL_REACH_THRESHOLD) {
                    finish(bot);
                    return;
                }
            } else {
                finish(bot);
                return;
            }
        }

        LOG.debug("MovementExecutor: advancing to segment {}/{}", currentSegmentIndex, pathPoints.size());
    }

    /**
     * 完成移动。
     */
    private void finish(BotHandle bot) {
        // 减速停止
        for (int i = 0; i < 5; i++) {
            movementController.calculateVelocity(null, stateMachine.getState(), false, true);
        }

        inputController.releaseAll(bot);
        inputController.processInputQueue(bot);
        actionController.stopAll(bot);

        running = false;
        finished = true;
        LOG.debug("MovementExecutor: finished at {}", bot.position());
    }

    /**
     * 根据移动模式应用输入。
     */
    private void applyMovementInputs(BotHandle bot, MoveMode mode, Vec3 velocity) {
        switch (mode) {
            case WALK -> {
                // 前进 + 视情况疾跑
                if (velocity.length() > 0.1) {
                    inputController.hold(bot, Input.FORWARD);
                }
                boolean isSprinting = velocity.length() > 4.0;
                if (isSprinting) {
                    inputController.hold(bot, Input.SPRINT);
                } else {
                    inputController.release(bot, Input.SPRINT);
                }
                inputController.release(bot, Input.SNEAK);
            }
            case SPRINT, SPRINT_JUMP -> {
                inputController.hold(bot, Input.FORWARD);
                inputController.hold(bot, Input.SPRINT);
                if (mode == MoveMode.SPRINT_JUMP) {
                    inputController.hold(bot, Input.JUMP);
                }
            }
            case SWIM -> {
                inputController.hold(bot, Input.FORWARD);
                inputController.hold(bot, Input.JUMP);
            }
            case CLIMB -> {
                inputController.hold(bot, Input.FORWARD);
                // 梯子上需要向上看
                lookController.setTarget(lookController.getCurrentYaw(), -30.0f);
            }
            case ELYTRA -> {
                inputController.hold(bot, Input.FORWARD);
                // 鞘翅滑翔时视角朝下
                lookController.setTarget(lookController.getCurrentYaw(), 30.0f);
            }
            case RIDE, BOAT -> {
                inputController.hold(bot, Input.FORWARD);
            }
            case BREAK_BLOCK, PLACE_BLOCK -> {
                // 方块操作由 Task 单独控制
                inputController.release(bot, Input.FORWARD);
                inputController.release(bot, Input.SPRINT);
            }
        }
    }

    // ──────────────────────────────────────────────
    //  查询
    // ──────────────────────────────────────────────

    public boolean isRunning() { return running; }
    public boolean isFinished() { return finished; }
    public MovementStateMachine getStateMachine() { return stateMachine; }
    public SmoothLookController getLookController() { return lookController; }
    public SmoothMovementController getMovementController() { return movementController; }
    public SmoothInputController getInputController() { return inputController; }
    public MovementContext getContext() { return context; }

    /**
     * 复位执行器。
     */
    public void reset() {
        pathPoints = null;
        finalDestination = null;
        currentSegmentIndex = 0;
        running = false;
        finished = false;
        lastPosition = null;
        stableTicks = 0;
        stateMachine.reset();
        lookController.reset();
        movementController.reset();
        inputController.reset();
        context.reset();
    }
}