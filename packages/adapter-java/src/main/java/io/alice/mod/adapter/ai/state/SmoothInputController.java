package io.alice.mod.adapter.ai.state;

import io.alice.mod.adapter.api.service.BotHandle;
import net.minecraft.client.KeyMapping;
import net.minecraft.server.level.ServerPlayer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.*;

/**
 * 输入平滑控制器。
 * <p>
 * 目标：模拟真实玩家的按键行为，不是瞬间按下/释放。
 * <p>
 * 设计要点：
 * <ul>
 *   <li>按键按下/释放加入随机延迟 (50-200ms)</li>
 *   <li>连续动作之间加入随机间隔 (100-300ms)</li>
 *   <li>使用输入缓冲队列，而不是直接操作 KeyBinding</li>
 *   <li>支持持续按住（hold）和单次按下（click）两种模式</li>
 *   <li>所有输入通过 Carpet ActionPack 或 KeyMapping 发送</li>
 * </ul>
 */
public class SmoothInputController {

    private static final Logger LOG = LoggerFactory.getLogger(SmoothInputController.class);

    // ──────────────────────────────────────────────
    //  常量
    // ──────────────────────────────────────────────

    /** 最短按键按下延迟（ms）。 */
    private static final long MIN_PRESS_DELAY = 50;
    /** 最长按键按下延迟（ms）。 */
    private static final long MAX_PRESS_DELAY = 200;
    /** 动作间最少间隔（ms）。 */
    private static final long MIN_ACTION_GAP = 100;
    /** 动作间最大间隔（ms）。 */
    private static final long MAX_ACTION_GAP = 300;

    // ──────────────────────────────────────────────
    //  输入类型枚举
    // ──────────────────────────────────────────────

    /** 游戏输入类型。 */
    public enum Input {
        FORWARD, BACKWARD, LEFT, RIGHT,
        JUMP, SNEAK, SPRINT,
        ATTACK, USE,
        DROP, SWAP_HANDS
    }

    // ──────────────────────────────────────────────
    //  内部数据结构
    // ──────────────────────────────────────────────

    private static class ScheduledInput {
        final Input input;
        final boolean pressed;
        final long executeTime;
        final boolean isHold;

        ScheduledInput(Input input, boolean pressed, long executeTime, boolean isHold) {
            this.input = input;
            this.pressed = pressed;
            this.executeTime = executeTime;
            this.isHold = isHold;
        }
    }

    // ──────────────────────────────────────────────
    //  状态
    // ──────────────────────────────────────────────

    private final Queue<ScheduledInput> inputQueue = new LinkedList<>();
    private final Set<Input> heldInputs = new HashSet<>();
    private long lastActionTime = 0;

    // ──────────────────────────────────────────────
    //  公开接口
    // ──────────────────────────────────────────────

    /**
     * 安排一个单次输入动作（按下后释放）。
     * 例如：点击攻击、使用物品。
     *
     * @param input   输入类型
     * @param bot     假人句柄
     */
    public void click(BotHandle bot, Input input) {
        long delay = MIN_PRESS_DELAY + (long) (Math.random() * (MAX_PRESS_DELAY - MIN_PRESS_DELAY));
        long gap = MIN_ACTION_GAP + (long) (Math.random() * (MAX_ACTION_GAP - MIN_ACTION_GAP));
        long now = System.currentTimeMillis();

        // 按下
        inputQueue.add(new ScheduledInput(input, true, now + delay + gap, false));
        // 释放（50ms 后）
        inputQueue.add(new ScheduledInput(input, false, now + delay + gap + 50, false));
    }

    /**
     * 安排持续按住一个输入（不自动释放）。
     * 例如：按住前进、按住右键使用物品。
     *
     * @param input   输入类型
     * @param bot     假人句柄
     */
    public void hold(BotHandle bot, Input input) {
        if (heldInputs.contains(input)) return; // 已按住

        long delay = MIN_PRESS_DELAY + (long) (Math.random() * (MAX_PRESS_DELAY - MIN_PRESS_DELAY));
        long gap = MIN_ACTION_GAP + (long) (Math.random() * (MAX_ACTION_GAP - MIN_ACTION_GAP));
        long now = System.currentTimeMillis();

        inputQueue.add(new ScheduledInput(input, true, now + delay + gap, true));
        heldInputs.add(input);
    }

    /**
     * 释放一个持续按住输入。
     *
     * @param input   输入类型
     * @param bot     假人句柄
     */
    public void release(BotHandle bot, Input input) {
        if (!heldInputs.contains(input)) return;

        long delay = MIN_PRESS_DELAY + (long) (Math.random() * (MAX_PRESS_DELAY - MIN_PRESS_DELAY));
        long now = System.currentTimeMillis();

        inputQueue.add(new ScheduledInput(input, false, now + delay, false));
        heldInputs.remove(input);
    }

    /**
     * 释放所有正在按住的输入。
     */
    public void releaseAll(BotHandle bot) {
        for (Input input : new HashSet<>(heldInputs)) {
            release(bot, input);
        }
    }

    // ──────────────────────────────────────────────
    //  tick 处理
    // ──────────────────────────────────────────────

    /**
     * 每 tick 调用，处理到期的输入事件。
     *
     * @param bot 假人句柄
     */
    public void processInputQueue(BotHandle bot) {
        long now = System.currentTimeMillis();

        while (!inputQueue.isEmpty() && inputQueue.peek().executeTime <= now) {
            ScheduledInput si = inputQueue.poll();
            applyInput(bot, si.input, si.pressed);
            lastActionTime = now;
        }
    }

    // ──────────────────────────────────────────────
    //  输入应用
    // ──────────────────────────────────────────────

    /**
     * 将输入应用到假人。
     * <p>
     * 服务端控制假人，使用 Carpet 命令或直接修改玩家状态。
     */
    private void applyInput(BotHandle bot, Input input, boolean pressed) {
        ServerPlayer player = bot.getNativePlayer();
        if (player == null) return;

        // 通过 Carpet ActionPack 命令控制
        String actionName = switch (input) {
            case FORWARD -> "forward";
            case BACKWARD -> "backward";
            case LEFT -> "left";
            case RIGHT -> "right";
            case JUMP -> "jump";
            case SNEAK -> "sneak";
            case SPRINT -> "sprint";
            case ATTACK -> "attack";
            case USE -> "use";
            case DROP -> "drop";
            case SWAP_HANDS -> "swapHands";
        };

        // 构造 Carpet 命令
        // 格式: /player <name> <action> [stop]
        String command;
        if (pressed) {
            command = String.format("player %s %s", bot.name(), actionName);
        } else {
            command = String.format("player %s %s stop", bot.name(), actionName);
        }

        // 执行命令
        if (player.server != null) {
            player.server.getCommands().performPrefixedCommand(
                    player.server.createCommandSourceStack(), command);
        }

        LOG.trace("Input: {} {} (via command: {})", input, pressed ? "PRESS" : "RELEASE", command);
    }

    // ──────────────────────────────────────────────
    //  查询
    // ──────────────────────────────────────────────

    /** 是否有正在等待处理的输入。 */
    public boolean hasPendingInputs() {
        return !inputQueue.isEmpty();
    }

    /** 获取当前正在按住的输入集合。 */
    public Set<Input> getHeldInputs() {
        return Collections.unmodifiableSet(heldInputs);
    }

    /** 获取上次动作时间。 */
    public long getLastActionTime() {
        return lastActionTime;
    }

    /**
     * 复位所有状态。
     */
    public void reset() {
        inputQueue.clear();
        heldInputs.clear();
        lastActionTime = 0;
    }
}