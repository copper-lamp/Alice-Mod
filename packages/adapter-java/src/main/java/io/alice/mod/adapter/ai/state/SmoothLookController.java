package io.alice.mod.adapter.ai.state;

import io.alice.mod.adapter.api.service.BotHandle;
import net.minecraft.server.level.ServerPlayer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * 视角平滑控制器。
 * <p>
 * 目标：假人转头时像真实玩家一样平滑过渡，而不是瞬移视角。
 * <p>
 * 设计要点：
 * <ul>
 *   <li>角速度限制：水平 max 180°/s，垂直 max 90°/s</li>
 *   <li>使用三次缓动函数（ease-in-out cubic），距离越近速度越慢</li>
 *   <li>加入随机微小抖动 (±0.5°) 模拟手持鼠标的自然抖动</li>
 *   <li>当目标角度差小于 1° 时，直接 snap 防止微小抖动</li>
 *   <li>支持紧急 snap（用于条件触发场景，如爬行者爆炸）</li>
 * </ul>
 */
public class SmoothLookController {

    private static final Logger LOG = LoggerFactory.getLogger(SmoothLookController.class);

    // ──────────────────────────────────────────────
    //  常量
    // ──────────────────────────────────────────────

    /** 最大水平角速度（度/秒）。 */
    private static final float MAX_YAW_SPEED = 180.0f;
    /** 最大垂直角速度（度/秒）。 */
    private static final float MAX_PITCH_SPEED = 90.0f;
    /** 小角度直接 snap 的阈值（度）。 */
    private static final float SNAP_THRESHOLD = 1.0f;
    /** 随机抖动幅度（度）。 */
    private static final float JITTER_AMPLITUDE = 0.5f;
    /** 缓动参考角度（度）。超过此角度使用最大速度。 */
    private static final float EASING_REFERENCE = 45.0f;

    // ──────────────────────────────────────────────
    //  状态
    // ──────────────────────────────────────────────

    private float currentYaw;
    private float currentPitch;
    private float targetYaw;
    private float targetPitch;
    private long lastUpdateTime = System.currentTimeMillis();

    /** 是否正在平滑过渡中。 */
    private boolean smoothing = false;

    // ──────────────────────────────────────────────
    //  核心更新
    // ──────────────────────────────────────────────

    /**
     * 设置目标视角。
     *
     * @param yaw   目标水平角（度）
     * @param pitch 目标垂直角（度）
     */
    public void setTarget(float yaw, float pitch) {
        this.targetYaw = normalizeAngle(yaw);
        this.targetPitch = clampPitch(pitch);
        this.smoothing = true;
    }

    /**
     * 每 tick 调用，更新视角并应用到假人。
     *
     * @param bot 假人句柄
     * @return 当前应应用的视角 (yaw, pitch)
     */
    public LookResult update(BotHandle bot) {
        long now = System.currentTimeMillis();
        float deltaTime = Math.min((now - lastUpdateTime) / 1000.0f, 0.05f); // 最多 50ms
        lastUpdateTime = now;

        float yawDiff = normalizeAngle(targetYaw - currentYaw);
        float pitchDiff = targetPitch - currentPitch;

        // 小角度直接 snap
        if (Math.abs(yawDiff) < SNAP_THRESHOLD && Math.abs(pitchDiff) < SNAP_THRESHOLD) {
            if (smoothing) {
                currentYaw = targetYaw;
                currentPitch = targetPitch;
                smoothing = false;
                applyRotation(bot, currentYaw, currentPitch);
            }
            return new LookResult(currentYaw, currentPitch);
        }

        // 计算平滑步长
        float yawStep = calculateSmoothStep(yawDiff, deltaTime, MAX_YAW_SPEED);
        float pitchStep = calculateSmoothStep(pitchDiff, deltaTime, MAX_PITCH_SPEED);

        // 应用速度限制
        float maxYawDelta = MAX_YAW_SPEED * deltaTime;
        float maxPitchDelta = MAX_PITCH_SPEED * deltaTime;
        yawStep = clampAbs(yawStep, maxYawDelta);
        pitchStep = clampAbs(pitchStep, maxPitchDelta);

        currentYaw = normalizeAngle(currentYaw + yawStep);
        currentPitch = clampPitch(currentPitch + pitchStep);

        // 加入微小的随机抖动（模拟人类手持鼠标）
        float jitterYaw = (float) ((Math.random() - 0.5) * 2 * JITTER_AMPLITUDE);
        float jitterPitch = (float) ((Math.random() - 0.5) * 2 * JITTER_AMPLITUDE);

        float finalYaw = currentYaw + jitterYaw;
        float finalPitch = currentPitch + jitterPitch;

        applyRotation(bot, finalYaw, finalPitch);
        return new LookResult(finalYaw, finalPitch);
    }

    /**
     * 紧急 snap 到目标视角（用于紧急场景如爬行者爆炸）。
     */
    public void snapTo(float yaw, float pitch) {
        this.currentYaw = normalizeAngle(yaw);
        this.currentPitch = clampPitch(pitch);
        this.targetYaw = this.currentYaw;
        this.targetPitch = this.currentPitch;
        this.smoothing = false;
        LOG.debug("SmoothLook: snapped to yaw={}, pitch={}", currentYaw, currentPitch);
    }

    // ──────────────────────────────────────────────
    //  平滑算法
    // ──────────────────────────────────────────────

    /**
     * 三次 Hermite 缓动函数（ease-in-out cubic）。
     * <p>
     * 距离大时用最大速度，距离小时速度逐渐降低。
     * 模拟人类瞄准时"先快后慢"的特征。
     *
     * @param diff      角度差
     * @param dt        时间增量（秒）
     * @param maxSpeed  最大角速度（度/秒）
     * @return 本帧应移动的角度
     */
    private float calculateSmoothStep(float diff, float dt, float maxSpeed) {
        float absDiff = Math.abs(diff);
        float sign = Math.signum(diff);

        // 缓动比例：距离越大比例越接近 1（全速），距离越小越接近 0
        float t = Math.min(1.0f, absDiff / EASING_REFERENCE);
        // 三次 Hermite 插值 (3t² - 2t³)：先快后慢
        float easedT = t * t * (3.0f - 2.0f * t);

        return sign * maxSpeed * dt * easedT;
    }

    /**
     * 将值限制在 [-max, max] 范围内。
     */
    private float clampAbs(float value, float max) {
        return Math.signum(value) * Math.min(Math.abs(value), max);
    }

    // ──────────────────────────────────────────────
    //  应用视角
    // ──────────────────────────────────────────────

    /**
     * 将视角应用到假人。
     * 使用 Carpet ActionPack 的 look 命令或直接设置玩家视角。
     */
    private void applyRotation(BotHandle bot, float yaw, float pitch) {
        ServerPlayer player = bot.getNativePlayer();
        if (player == null) return;

        // 直接设置玩家视角（服务端有效）
        player.setYRot(yaw);
        player.setXRot(pitch);
        // 更新玩家头部旋转
        player.yHeadRot = yaw;
        // 通知客户端更新
        player.connection.teleport(
                player.getX(), player.getY(), player.getZ(),
                yaw, pitch
        );
    }

    // ──────────────────────────────────────────────
    //  角度工具
    // ──────────────────────────────────────────────

    /** 将角度归一化到 [-180, 180]。 */
    public static float normalizeAngle(float angle) {
        angle = angle % 360.0f;
        if (angle > 180.0f) angle -= 360.0f;
        if (angle < -180.0f) angle += 360.0f;
        return angle;
    }

    /** 将俯仰角限制在 [-90, 90]。 */
    public static float clampPitch(float pitch) {
        return Math.max(-90.0f, Math.min(90.0f, pitch));
    }

    // ──────────────────────────────────────────────
    //  查询
    // ──────────────────────────────────────────────

    public float getCurrentYaw() {
        return currentYaw;
    }

    public float getCurrentPitch() {
        return currentPitch;
    }

    public float getTargetYaw() {
        return targetYaw;
    }

    public float getTargetPitch() {
        return targetPitch;
    }

    public boolean isSmoothing() {
        return smoothing;
    }

    /**
     * 复位视角状态。
     */
    public void reset() {
        currentYaw = 0;
        currentPitch = 0;
        targetYaw = 0;
        targetPitch = 0;
        smoothing = false;
        lastUpdateTime = System.currentTimeMillis();
    }

    /**
     * 视角计算结果值对象。
     */
    public record LookResult(float yaw, float pitch) {}
}