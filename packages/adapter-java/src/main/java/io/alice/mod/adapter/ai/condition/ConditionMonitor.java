package io.alice.mod.adapter.ai.condition;

import io.alice.mod.adapter.api.service.BotHandle;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.effect.MobEffects;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.monster.Creeper;
import net.minecraft.world.entity.monster.Monster;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.List;

/**
 * 条件监控器——评估环境并发出控制信号。
 * <p>
 * 参考 BE {@code adapter-bedrock/src/ai/movement/condition-monitor.ts} 设计。
 * <p>
 * 职责：每 tick 检查环境条件，生成控制信号：
 * <ul>
 *   <li>pause — 暂停当前任务（紧急情况）</li>
 *   <li>stop — 强制停止当前任务</li>
 *   <li>replan — 重新规划路径</li>
 *   <li>none — 无事发生</li>
 * </ul>
 * <p>
 * 条件优先级（从高到低）：
 * <ol>
 *   <li>死亡检查</li>
 *   <li>极端低血量（< 3♥）</li>
 *   <li>熔岩/火焰</li>
 *   <li>高速下落</li>
 *   <li>爬行者爆炸</li>
 *   <li>敌对生物威胁</li>
 *   <li>饥饿</li>
 *   <li>卡住检测</li>
 * </ol>
 */
public class ConditionMonitor {

    private static final Logger LOG = LoggerFactory.getLogger(ConditionMonitor.class);

    // ──────────────────────────────────────────────
    //  常量
    // ──────────────────────────────────────────────

    /** 极端低血量阈值（< 3♥）。 */
    private static final float CRITICAL_HEALTH = 6.0f;
    /** 低血量阈值（< 6♥）。 */
    private static final float LOW_HEALTH = 12.0f;
    /** 低饥饿阈值（< 5 个鸡腿）。 */
    private static final int LOW_HUNGER = 10;
    /** 高速下落速度阈值。 */
    private static final double FALL_SPEED_THRESHOLD = -0.7;
    /** 爬行者危险距离。 */
    private static final double CREEPER_DANGER_DISTANCE = 6.0;
    /** 敌对生物警戒距离。 */
    private static final double HOSTILE_ALERT_DISTANCE = 8.0;
    /** 卡住检测时间（ms）。 */
    private static final long STUCK_DURATION = 3000;
    /** 卡住检测位置变化阈值。 */
    private static final double STUCK_MOVEMENT_THRESHOLD = 0.1;

    // ──────────────────────────────────────────────
    //  控制信号
    // ──────────────────────────────────────────────

    public enum ControlSignal {
        NONE,
        PAUSE,
        STOP,
        REPLAN
    }

    // ──────────────────────────────────────────────
    //  状态
    // ──────────────────────────────────────────────

    private ControlSignal lastSignal = ControlSignal.NONE;
    private String lastReason = "";

    // 卡住检测状态
    private double lastCheckX, lastCheckZ;
    private long lastCheckTime;
    private double stuckDistance;

    // ──────────────────────────────────────────────
    //  核心评估
    // ──────────────────────────────────────────────

    /**
     * 评估当前环境条件，生成控制信号。
     * <p>
     * 每 tick 由外部驱动调用。
     *
     * @param bot 假人句柄
     * @return 控制信号
     */
    public ControlSignal evaluate(BotHandle bot) {
        ServerPlayer player = bot.getNativePlayer();
        if (player == null) {
            return ControlSignal.STOP;
        }

        // 1. 死亡检查
        if (!player.isAlive() || player.getHealth() <= 0) {
            return signal(ControlSignal.STOP, "dead");
        }

        // 2. 极端低血量
        if (player.getHealth() < CRITICAL_HEALTH) {
            return signal(ControlSignal.PAUSE, "critical_health(" + player.getHealth() + ")");
        }

        // 3. 熔岩/火焰
        if (player.isInLava() || (player.isOnFire() && !player.hasEffect(MobEffects.FIRE_RESISTANCE))) {
            return signal(ControlSignal.STOP, "lava/fire");
        }

        // 4. 高速下落（需要水桶或防止摔死）
        if (isFalling(player)) {
            return signal(ControlSignal.PAUSE, "falling");
        }

        // 5. 爬行者爆炸
        if (isCreeperAboutToExplode(player)) {
            return signal(ControlSignal.PAUSE, "creeper_about_to_explode");
        }

        // 6. 敌对生物威胁
        if (isHostileThreat(player)) {
            return signal(ControlSignal.PAUSE, "hostile_threat");
        }

        // 7. 饥饿
        if (player.getFoodData().getFoodLevel() < LOW_HUNGER) {
            return signal(ControlSignal.PAUSE, "low_hunger(" + player.getFoodData().getFoodLevel() + ")");
        }

        // 8. 卡住检测
        if (isStuck(player)) {
            return signal(ControlSignal.REPLAN, "stuck");
        }

        return signal(ControlSignal.NONE, "");
    }

    // ──────────────────────────────────────────────
    //  条件检测
    // ──────────────────────────────────────────────

    /**
     * 检测是否正在快速下落。
     */
    private boolean isFalling(ServerPlayer player) {
        if (player.onGround() || player.isSwimming() || player.isClimbing() || player.isInWater()) {
            return false;
        }
        return player.getDeltaMovement().y < FALL_SPEED_THRESHOLD;
    }

    /**
     * 检测是否有爬行者即将爆炸。
     */
    private boolean isCreeperAboutToExplode(ServerPlayer player) {
        List<Creeper> creepers = player.serverLevel().getEntities().getAll()
                .stream()
                .filter(e -> e instanceof Creeper)
                .map(e -> (Creeper) e)
                .filter(c -> c.isAlive() && c.distanceTo(player) < CREEPER_DANGER_DISTANCE)
                .toList();

        for (Creeper creeper : creepers) {
            if (creeper.getSwellDir() > 0) {
                return true;
            }
        }
        return false;
    }

    /**
     * 检测是否有敌对生物构成威胁。
     * <p>
     * 低血量时对近距离敌对生物更敏感。
     */
    private boolean isHostileThreat(ServerPlayer player) {
        float health = player.getHealth();
        double alertRange = (health < LOW_HEALTH) ? HOSTILE_ALERT_DISTANCE : HOSTILE_ALERT_DISTANCE * 0.5;

        List<Monster> hostiles = player.serverLevel().getEntities().getAll()
                .stream()
                .filter(e -> e instanceof Monster)
                .map(e -> (Monster) e)
                .filter(m -> m.isAlive() && m.distanceTo(player) < alertRange)
                .toList();

        return !hostiles.isEmpty();
    }

    /**
     * 检测是否卡住（位置长时间没有明显变化）。
     */
    private boolean isStuck(ServerPlayer player) {
        double x = player.getX();
        double z = player.getZ();
        long now = System.currentTimeMillis();

        if (lastCheckTime == 0) {
            lastCheckX = x;
            lastCheckZ = z;
            lastCheckTime = now;
            return false;
        }

        double dx = x - lastCheckX;
        double dz = z - lastCheckZ;
        stuckDistance += Math.sqrt(dx * dx + dz * dz);

        // 每 tick 重置
        lastCheckX = x;
        lastCheckZ = z;

        // 如果超过 STUCK_DURATION 时间移动距离小于阈值，认为卡住
        if (now - lastCheckTime > STUCK_DURATION) {
            boolean stuck = stuckDistance < STUCK_MOVEMENT_THRESHOLD;
            lastCheckTime = now;
            stuckDistance = 0;
            return stuck;
        }

        return false;
    }

    // ──────────────────────────────────────────────
    //  信号管理
    // ──────────────────────────────────────────────

    private ControlSignal signal(ControlSignal signal, String reason) {
        lastSignal = signal;
        lastReason = reason;
        return signal;
    }

    /**
     * 获取上次生成的控制信号。
     */
    public ControlSignal getLastSignal() {
        return lastSignal;
    }

    /**
     * 获取上次生成信号的原因。
     */
    public String getLastReason() {
        return lastReason;
    }

    /**
     * 复位状态。
     */
    public void reset() {
        lastSignal = ControlSignal.NONE;
        lastReason = "";
        lastCheckX = 0;
        lastCheckZ = 0;
        lastCheckTime = 0;
        stuckDistance = 0;
    }
}