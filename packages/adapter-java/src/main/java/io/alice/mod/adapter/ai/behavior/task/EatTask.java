package io.alice.mod.adapter.ai.behavior.task;

import io.alice.mod.adapter.ai.behavior.ITaskOverridesGrounded;
import io.alice.mod.adapter.ai.behavior.Task;
import io.alice.mod.adapter.api.service.BotHandle;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.food.FoodProperties;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * 进食任务——自动吃背包中的食物直至满。
 * <p>
 * 从 altoclef 概念移植。
 * <p>
 * 实现 {@link ITaskOverridesGrounded}，空中也可以进食。
 */
public class EatTask extends Task implements ITaskOverridesGrounded {

    private static final Logger LOG = LoggerFactory.getLogger(EatTask.class);

    // ──────────────────────────────────────────────
    //  常量
    // ──────────────────────────────────────────────

    /** 进食超时（tick）。 */
    private static final int EAT_TIMEOUT_TICKS = 200; // 10 秒
    /** 进食间隔（ms）。 */
    private static final long EAT_INTERVAL_MS = 100;

    // ──────────────────────────────────────────────
    //  状态
    // ──────────────────────────────────────────────

    private int tickCount = 0;
    private long lastEatTime = 0;
    private boolean eating = false;

    public EatTask() {
        setDebugState("Eat");
    }

    // ──────────────────────────────────────────────
    //  生命周期
    // ──────────────────────────────────────────────

    @Override
    protected void onStart(BotHandle bot) {
        tickCount = 0;
        eating = false;
        lastEatTime = 0;
        LOG.debug("EatTask: start");
    }

    @Override
    protected Task onTick(BotHandle bot) {
        ServerPlayer player = bot.getNativePlayer();
        if (player == null) return null;

        tickCount++;

        // 超时检查
        if (tickCount > EAT_TIMEOUT_TICKS) {
            setDebugState("Eat timeout");
            stopEating(bot, player);
            return null;
        }

        // 饥饿值已满
        int foodLevel = player.getFoodData().getFoodLevel();
        if (foodLevel >= 20) {
            setDebugState("Full");
            stopEating(bot, player);
            return null;
        }

        // 检查背包中是否有食物
        ItemStack bestFood = null;
        int bestScore = -1;

        for (int i = 0; i < player.getInventory().getContainerSize(); i++) {
            ItemStack stack = player.getInventory().getItem(i);
            if (stack.isEmpty() || !stack.isEdible()) continue;

            FoodProperties food = stack.getItem().getFoodProperties();
            if (food == null) continue;

            // 评分：考虑饥饿恢复和饱和度
            int score = food.getNutrition() * 2 + (int) food.getSaturationModifier();
            if (score > bestScore) {
                bestScore = score;
                bestFood = stack;
            }
        }

        if (bestFood == null) {
            setDebugState("No food");
            return null;
        }

        // 装备食物到主手
        int slot = findSlot(player, bestFood);
        if (slot >= 0) {
            equipSlot(bot, player, slot);
        }

        // 进食
        long now = System.currentTimeMillis();
        if (now - lastEatTime > EAT_INTERVAL_MS) {
            String useCmd = String.format("player %s useItem", bot.name());
            executeCommand(bot, useCmd);
            lastEatTime = now;
            eating = true;
            setDebugState("Eating " + bestFood.getDisplayName().getString());
        }

        return null;
    }

    @Override
    protected void onStop(BotHandle bot, Task interruptTask) {
        ServerPlayer player = bot.getNativePlayer();
        if (player != null) {
            stopEating(bot, player);
        }
        LOG.debug("EatTask: stopped");
    }

    @Override
    public boolean isFinished(BotHandle bot) {
        ServerPlayer player = bot.getNativePlayer();
        if (player == null) return true;
        return player.getFoodData().getFoodLevel() >= 20;
    }

    // ──────────────────────────────────────────────
    //  内部方法
    // ──────────────────────────────────────────────

    private void stopEating(BotHandle bot, ServerPlayer player) {
        if (eating) {
            String stopCmd = String.format("player %s useItem stop", bot.name());
            executeCommand(bot, stopCmd);
            eating = false;
        }
    }

    private int findSlot(ServerPlayer player, ItemStack target) {
        for (int i = 0; i < player.getInventory().getContainerSize(); i++) {
            if (player.getInventory().getItem(i).getItem() == target.getItem()) {
                return i;
            }
        }
        return -1;
    }

    private void equipSlot(BotHandle bot, ServerPlayer player, int slot) {
        String equipCmd = String.format("player %s equip hotbar %d", bot.name(), slot);
        executeCommand(bot, equipCmd);
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
        return other instanceof EatTask;
    }

    @Override
    protected String toDebugString() {
        return "Eat";
    }
}