package io.alice.mod.adapter.ai.state;

import io.alice.mod.adapter.api.service.BotHandle;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * 移动状态机。
 * <p>
 * 参考 BE {@code adapter-bedrock/src/ai/movement/state-machine.ts} 实现。
 * <p>
 * 管理 10 个移动状态之间的转换，提供平滑的状态切换。
 * BREAK_BLOCK 和 PLACE_BLOCK 完成后会自动恢复到前一个状态。
 */
public class MovementStateMachine {

    private static final Logger LOG = LoggerFactory.getLogger(MovementStateMachine.class);

    private MoveMode state = MoveMode.WALK;
    private MoveMode previousState = MoveMode.WALK;

    // ──────────────────────────────────────────────
    //  状态转换
    // ──────────────────────────────────────────────

    /**
     * 尝试转换到目标状态。
     * <p>
     * 转换规则：
     * <ul>
     *   <li>BREAK_BLOCK / PLACE_BLOCK → 记录前一个状态，允许从任何状态进入</li>
     *   <li>从 BREAK_BLOCK / PLACE_BLOCK 恢复 → 回到前一个状态</li>
     *   <li>其他状态转换 → 检查是否允许</li>
     * </ul>
     *
     * @param to  目标状态
     * @param bot 假人句柄（用于环境检测）
     * @return 是否转换成功
     */
    public boolean transition(MoveMode to, BotHandle bot) {
        // BREAK_BLOCK / PLACE_BLOCK 可以随时进入
        if (to == MoveMode.BREAK_BLOCK || to == MoveMode.PLACE_BLOCK) {
            previousState = state;
            state = to;
            LOG.debug("State: {} → {} (action)", previousState, to);
            return true;
        }

        // 从 BREAK_BLOCK / PLACE_BLOCK 恢复
        if (state == MoveMode.BREAK_BLOCK || state == MoveMode.PLACE_BLOCK) {
            if (previousState == to) {
                state = to;
                LOG.debug("State: {} → {} (recover)", state, to);
                return true;
            }
            // 如果目标状态不等于前一个状态，顺序恢复后再转换
            state = previousState;
            return transition(to, bot);
        }

        // 检查是否允许转换
        if (canTransition(state, to, bot)) {
            LOG.debug("State: {} → {}", state, to);
            state = to;
            return true;
        }

        return false;
    }

    /**
     * 自动检测环境并转换状态。
     * <p>
     * 每 tick 由 MovementExecutor 调用，处理自动状态转换。
     */
    public void autoTransition(BotHandle bot) {
        if (state == MoveMode.BREAK_BLOCK || state == MoveMode.PLACE_BLOCK) {
            return; // 动作状态下不自动转换
        }

        Object nativePlayer = bot.getNativePlayer();
        if (nativePlayer instanceof net.minecraft.server.level.ServerPlayer player) {
            // 游泳检测（最高优先级）
            if (player.isSwimming() || player.isInWater()) {
                if (state != MoveMode.SWIM) {
                    transition(MoveMode.SWIM, bot);
                }
                return;
            }

            // 攀爬检测
            if (player.onClimbable()) {
                if (state != MoveMode.CLIMB) {
                    transition(MoveMode.CLIMB, bot);
                }
                return;
            }

            // 如果不游泳不攀爬，回到行走/疾跑
            if (state == MoveMode.SWIM || state == MoveMode.CLIMB) {
                transition(MoveMode.WALK, bot);
            }
        }
    }

    // ──────────────────────────────────────────────
    //  转换规则
    // ──────────────────────────────────────────────

    /**
     * 检查是否可以从当前状态转换到目标状态。
     */
    private boolean canTransition(MoveMode from, MoveMode to, BotHandle bot) {
        return switch (from) {
            case WALK -> to != MoveMode.RIDE && to != MoveMode.BOAT; // RIDE/BOAT 需要外部触发
            case SPRINT -> to != MoveMode.RIDE && to != MoveMode.BOAT;
            case SPRINT_JUMP -> true; // 落地后自动回到 WALK
            case SWIM -> to == MoveMode.WALK || to == MoveMode.SPRINT;
            case CLIMB -> to == MoveMode.WALK || to == MoveMode.SPRINT;
            case ELYTRA -> to == MoveMode.WALK; // 碰撞地面后
            case RIDE, BOAT -> to == MoveMode.WALK; // 脱离坐骑后
            case BREAK_BLOCK, PLACE_BLOCK -> true; // 由外部驱动
        };
    }

    // ──────────────────────────────────────────────
    //  查询
    // ──────────────────────────────────────────────

    /** 获取当前状态。 */
    public MoveMode getState() {
        return state;
    }

    /** 获取前一个状态（用于动作恢复）。 */
    public MoveMode getPreviousState() {
        return previousState;
    }

    /**
     * 复位到行走状态。
     */
    public void reset() {
        state = MoveMode.WALK;
        previousState = MoveMode.WALK;
    }

    @Override
    public String toString() {
        return "StateMachine{" + state + "}";
    }
}