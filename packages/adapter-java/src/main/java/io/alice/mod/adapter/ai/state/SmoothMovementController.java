package io.alice.mod.adapter.ai.state;

import io.alice.mod.adapter.api.service.BotHandle;
import io.alice.mod.adapter.api.types.Vec3;
import net.minecraft.server.level.ServerPlayer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.EnumMap;
import java.util.Map;

/**
 * 移动平滑控制器。
 * <p>
 * 目标：假人移动时看起来像真实玩家，而不是瞬移或固定速度。
 * <p>
 * 设计要点：
 * <ul>
 *   <li>加速度曲线：起步慢→加速→匀速→减速→停止</li>
 *   <li>速度受状态影响：行走 4.3m/s, 疾跑 5.6m/s, 游泳 1.8m/s</li>
 *   <li>加入随机速度波动 (±3%) 模拟真实玩家</li>
 *   <li>转向时减速（模拟真实玩家拐弯时的减速）</li>
 *   <li>急停曲线：快速停止时逐步减速而不是瞬间刹车</li>
 * </ul>
 */
public class SmoothMovementController {

    private static final Logger LOG = LoggerFactory.getLogger(SmoothMovementController.class);

    // ──────────────────────────────────────────────
    //  速度常量（m/s，原版值）
    // ──────────────────────────────────────────────

    private static final Map<MoveMode, Double> MAX_SPEEDS = new EnumMap<>(MoveMode.class);

    static {
        MAX_SPEEDS.put(MoveMode.WALK, 4.317);
        MAX_SPEEDS.put(MoveMode.SPRINT, 5.612);
        MAX_SPEEDS.put(MoveMode.SPRINT_JUMP, 5.612);
        MAX_SPEEDS.put(MoveMode.SWIM, 1.8);
        MAX_SPEEDS.put(MoveMode.CLIMB, 2.0);
        MAX_SPEEDS.put(MoveMode.ELYTRA, 10.0);
        MAX_SPEEDS.put(MoveMode.RIDE, 8.0);
        MAX_SPEEDS.put(MoveMode.BOAT, 2.0);
        // BREAK_BLOCK / PLACE_BLOCK 使用 WALK 速度
        MAX_SPEEDS.put(MoveMode.BREAK_BLOCK, 4.317);
        MAX_SPEEDS.put(MoveMode.PLACE_BLOCK, 4.317);
    }

    private static final Map<MoveMode, Double> ACCELERATIONS = new EnumMap<>(MoveMode.class);

    static {
        ACCELERATIONS.put(MoveMode.WALK, 8.0);      // 约 1 tick 到满速
        ACCELERATIONS.put(MoveMode.SPRINT, 6.0);     // 约 1.5 tick 到满速
        ACCELERATIONS.put(MoveMode.SPRINT_JUMP, 6.0);
        ACCELERATIONS.put(MoveMode.SWIM, 4.0);       // 水中加速慢
        ACCELERATIONS.put(MoveMode.CLIMB, 5.0);
        ACCELERATIONS.put(MoveMode.ELYTRA, 3.0);     // 滑翔加速慢
        ACCELERATIONS.put(MoveMode.RIDE, 6.0);
        ACCELERATIONS.put(MoveMode.BOAT, 3.0);
        ACCELERATIONS.put(MoveMode.BREAK_BLOCK, 8.0);
        ACCELERATIONS.put(MoveMode.PLACE_BLOCK, 8.0);
    }

    // ──────────────────────────────────────────────
    //  平滑参数
    // ──────────────────────────────────────────────

    /** 速度随机波动幅度（±3%）。 */
    private static final double SPEED_VARIANCE = 0.03;
    /** 转向时减速比例（30%）。 */
    private static final double TURN_DECELERATION = 0.30;
    /** 急停系数（减速时的倍率，越大减速越快）。 */
    private static final double STOP_FACTOR = 2.0;
    /** 最小速度阈值，低于此值视为停止。 */
    private static final double MIN_SPEED_THRESHOLD = 0.01;

    // ──────────────────────────────────────────────
    //  状态
    // ──────────────────────────────────────────────

    private double currentSpeed = 0.0;
    private MoveMode currentMode = MoveMode.WALK;
    private Vec3 currentVelocity = Vec3.of(0, 0, 0);
    private Vec3 lastDirection = Vec3.of(0, 0, 0);

    // ──────────────────────────────────────────────
    //  核心逻辑
    // ──────────────────────────────────────────────

    /**
     * 计算当前 tick 的目标速度。
     * <p>
     * 这是整个移动平滑的核心方法，每 tick 调用一次。
     *
     * @param direction  移动方向（单位向量）
     * @param mode       当前移动模式
     * @param isTurning  是否正在转向
     * @param wantStop   是否希望停止移动
     * @return 当前应应用的速度向量
     */
    public Vec3 calculateVelocity(Vec3 direction, MoveMode mode, boolean isTurning, boolean wantStop) {
        this.currentMode = mode;

        double maxSpeed = MAX_SPEEDS.getOrDefault(mode, 4.317);
        double acceleration = ACCELERATIONS.getOrDefault(mode, 8.0);

        // 加入随机速度波动（模拟真实玩家的速度变化）
        double variance = 1.0 + (Math.random() - 0.5) * 2 * SPEED_VARIANCE;
        double actualMaxSpeed = maxSpeed * variance;

        // 转向时减速
        if (isTurning) {
            actualMaxSpeed *= (1.0 - TURN_DECELERATION);
        }

        // 急停处理
        if (wantStop || direction == null) {
            double decel = acceleration * STOP_FACTOR * 0.05;
            currentSpeed = Math.max(0, currentSpeed - decel);
            if (currentSpeed < MIN_SPEED_THRESHOLD) {
                currentSpeed = 0;
                currentVelocity = Vec3.of(0, 0, 0);
            } else {
                // 保持最后方向减速
                currentVelocity = scale(lastDirection, currentSpeed);
            }
            return currentVelocity;
        }

        // 记录方向
        this.lastDirection = normalize(direction);

        // 加速度计算：向目标速度逼近
        double desiredSpeed = actualMaxSpeed;
        double speedDiff = desiredSpeed - currentSpeed;

        // 每 tick 最大速度变化 = 加速度 * 0.05s
        double maxDelta = acceleration * 0.05;
        if (Math.abs(speedDiff) > maxDelta) {
            speedDiff = Math.signum(speedDiff) * maxDelta;
        }

        currentSpeed += speedDiff;
        currentSpeed = Math.max(0, currentSpeed);

        // 计算速度向量
        currentVelocity = scale(lastDirection, currentSpeed);
        return currentVelocity;
    }

    // ──────────────────────────────────────────────
    //  Vector 工具
    // ──────────────────────────────────────────────

    private Vec3 normalize(Vec3 v) {
        double len = Math.sqrt(v.x() * v.x() + v.y() * v.y() + v.z() * v.z());
        if (len < 1e-7) return Vec3.of(0, 0, 0);
        return Vec3.of(v.x() / len, v.y() / len, v.z() / len);
    }

    private Vec3 scale(Vec3 v, double s) {
        return Vec3.of(v.x() * s, v.y() * s, v.z() * s);
    }

    // ──────────────────────────────────────────────
    //  查询
    // ──────────────────────────────────────────────

    /** 获取当前速度向量。 */
    public Vec3 getCurrentVelocity() {
        return currentVelocity;
    }

    /** 获取当前速率（m/s）。 */
    public double getCurrentSpeed() {
        return currentSpeed;
    }

    /** 获取当前移动模式。 */
    public MoveMode getCurrentMode() {
        return currentMode;
    }

    /**
     * 复位所有状态。
     */
    public void reset() {
        currentSpeed = 0.0;
        currentMode = MoveMode.WALK;
        currentVelocity = Vec3.of(0, 0, 0);
        lastDirection = Vec3.of(0, 0, 0);
    }
}