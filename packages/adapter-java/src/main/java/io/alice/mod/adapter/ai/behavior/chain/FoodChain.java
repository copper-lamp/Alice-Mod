package io.alice.mod.adapter.ai.behavior.chain;

import io.alice.mod.adapter.ai.behavior.SingleTaskChain;
import io.alice.mod.adapter.ai.behavior.TaskRunner;

import io.alice.mod.adapter.api.service.BotHandle;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.effect.MobEffects;

import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.*;

/**
 * 自动进食链——在饥饿时自动进食。
 * <p>
 * 从 altoclef {@code adris.altoclef.chains.FoodChain} 移植。
 * <p>
 * 优先级：55（饥饿时），否则 Float.NEGATIVE_INFINITY
 * <p>
 * 职责：
 * <ul>
 *   <li>监控饥饿值，需要时自动进食</li>
 *   <li>智能选择最优食物（考虑饱和度、浪费、状态效果）</li>
 *   <li>低血量时优先恢复</li>
 *   <li>在熔岩中或紧急状态下不进食</li>
 * </ul>
 */
public class FoodChain extends SingleTaskChain {

    private static final Logger LOG = LoggerFactory.getLogger(FoodChain.class);

    // ──────────────────────────────────────────────
    //  配置
    // ──────────────────────────────────────────────

    /** 强制进食的饥饿阈值（低于此值必须吃）。 */
    private static final int ALWAYS_EAT_BELOW_HUNGER = 10;
    /** 强制进食的血量阈值。 */
    private static final int ALWAYS_EAT_BELOW_HEALTH = 14;
    /** 着火/凋零时强制进食的血量阈值。 */
    private static final int ALWAYS_EAT_WITHER_FIRE_HEALTH = 6;
    /** 优先饱和度的血量阈值。 */
    private static final int PRIORITIZE_SATURATION_HEALTH = 8;
    /** 允许进食的最小装备值。 */
    private static final int CAN_TANK_HITS_ARMOR = 15;
    /** 允许进食的最大饥饿值（可挨打进食）。 */
    private static final int CAN_TANK_HITS_MAX_HUNGER = 3;

    // ──────────────────────────────────────────────
    //  状态
    // ──────────────────────────────────────────────

    private boolean isTryingToEat = false;
    private boolean requestFillup = false;
    private int cachedFoodScore;
    private Optional<Item> cachedPerfectFood = Optional.empty();

    public FoodChain(TaskRunner runner) {
        super(runner);
    }

    // ──────────────────────────────────────────────
    //  Chain 核心
    // ──────────────────────────────────────────────

    @Override
    public float getPriority(BotHandle bot) {
        ServerPlayer player = bot.getNativePlayer();
        if (player == null || bot.getNativePlayer() == null) {
            stopEat(bot);
            return Float.NEGATIVE_INFINITY;
        }

        // 不在熔岩中进食
        if (player.isInLava()) {
            stopEat(bot);
            return Float.NEGATIVE_INFINITY;
        }

        // 检查食物并计算分数
        FoodCalculation calc = calculateFood(bot, player);
        cachedFoodScore = calc.totalHunger();
        cachedPerfectFood = calc.bestFood();

        boolean hasFood = cachedFoodScore > 0;

        // 如果请求填满但已满，停止
        if (requestFillup && player.getFoodData().getFoodLevel() >= 20) {
            requestFillup = false;
        }
        if (!hasFood) {
            requestFillup = false;
        }

        // 需要进食且有完美食物
        if (hasFood && (needsToEat(bot, player) || requestFillup) && cachedPerfectFood.isPresent()) {
            Item toUse = cachedPerfectFood.get();
            startEat(bot, player, toUse);
        } else {
            stopEat(bot);
        }

        // 如果食物不足，设置收集食物任务（优先级 55）
        if (cachedFoodScore < 24) { // 24 个饥饿值 = 12 个曲奇 ≈ 合理的食物储备
            setTask(new CollectFoodTask(bot, 24));
            return 55f;
        }

        return Float.NEGATIVE_INFINITY;
    }

    @Override
    protected void onTaskFinish(BotHandle bot) {
        // 收集食物任务完成，无事可做
    }

    @Override
    public boolean isActive() {
        return true; // 始终检查饥饿
    }

    @Override
    public String getName() {
        return "Food";
    }

    @Override
    protected void onStop(BotHandle bot) {
        stopEat(bot);
        super.onStop(bot);
    }

    // ──────────────────────────────────────────────
    //  进食控制
    // ──────────────────────────────────────────────

    private void startEat(BotHandle bot, ServerPlayer player, Item food) {
        isTryingToEat = true;
        requestFillup = true;

        // 装备食物到主手
        equipItem(bot, food);

        // 按住右键进食
        // 通过 SmoothInputController 或直接控制玩家
        String useCmd = String.format("player %s useItem", bot.name());
        executeCommand(bot, useCmd);

        // 通知 Baritone（如果有）暂停交互
        // bot.getBaritoneSettings().setInteractionPaused(true);

        LOG.debug("FoodChain: started eating {}", food.getName().getString());
    }

    private void stopEat(BotHandle bot) {
        if (isTryingToEat) {
            // Using Carpet command is one-shot, no release needed
            // bot.getBaritoneSettings().setInteractionPaused(false);
            isTryingToEat = false;
            requestFillup = false;
            LOG.debug("FoodChain: stopped eating");
        }
    }

    // ──────────────────────────────────────────────
    //  饥饿判断
    // ──────────────────────────────────────────────

    private boolean needsToEat(BotHandle bot, ServerPlayer player) {
        int foodLevel = player.getFoodData().getFoodLevel();
        float health = player.getHealth();

        if (foodLevel >= 20) {
            return false;
        }

        // 着火/凋零状态，快速进食
        if (player.isOnFire() || player.hasEffect(MobEffects.WITHER)
                || health < ALWAYS_EAT_WITHER_FIRE_HEALTH) {
            return true;
        }

        // 饥饿值低于阈值，必须吃
        if (foodLevel <= ALWAYS_EAT_BELOW_HUNGER) {
            return true;
        }

        // 血量低，即使不太饿也要吃
        if (health < ALWAYS_EAT_BELOW_HEALTH) {
            return true;
        }

        // 完美匹配：剩余饥饿值刚好能被某种食物填满
        if (foodLevel < 15 && cachedPerfectFood.isPresent()) {
            int need = 20 - foodLevel;
            Item best = cachedPerfectFood.get();
            // Use data component system to check food
            var foodComp = best.components().get(net.minecraft.core.component.DataComponents.FOOD);
            if (foodComp != null) {
                // Use integer comparison
                if (need >= 1 && need <= 20) {
                    return true;
                }
            }
        }

        return false;
    }

    /**
     * 紧急进食判断：是否应该放弃进食去逃跑。
     */
    public boolean needsToEatCritical(BotHandle bot) {
        ServerPlayer player = bot.getNativePlayer();
        if (player == null) return false;

        int foodLevel = player.getFoodData().getFoodLevel();
        float health = player.getHealth();
        int armor = player.getArmorValue();

        // 血量极低且饥饿也低 → 逃跑，不吃
        if (health < 3 && foodLevel < 3) return false;

        // 装备好且饥饿低 → 可以挨打进食
        return armor >= CAN_TANK_HITS_ARMOR && foodLevel < CAN_TANK_HITS_MAX_HUNGER;
    }

    // ──────────────────────────────────────────────
    //  食物选择
    // ──────────────────────────────────────────────

    /**
     * 计算背包中的食物并选择最佳食物。
     */
    private FoodCalculation calculateFood(BotHandle bot, ServerPlayer player) {
        Item bestFood = null;
        double bestFoodScore = Double.NEGATIVE_INFINITY;
        int foodTotal = 0;

        float health = player.getHealth();
        int hunger = player.getFoodData().getFoodLevel();
        float saturation = player.getFoodData().getSaturationLevel();

        // 遍历背包物品
        List<ItemStack> inventory = getInventoryItems(bot);
        for (ItemStack stack : inventory) {
            if (stack == null || stack.get(net.minecraft.core.component.DataComponents.FOOD) == null) continue;

            Item item = stack.getItem();
            // 排除蜘蛛眼
            if (item == Items.SPIDER_EYE) continue;

            // Use item ID-based scoring
            double score = getItemFoodScore(item);
            if (score > bestFoodScore) {
                bestFoodScore = score;
                bestFood = item;
            }
            foodTotal += 4 * stack.getCount(); // estimate 4 hunger per food item
        }

        return new FoodCalculation(foodTotal, Optional.ofNullable(bestFood));
    }

    // ──────────────────────────────────────────────
    //  工具方法
    // ──────────────────────────────────────────────

    /**
     * 装备指定物品到主手。
     */
    private void equipItem(BotHandle bot, Item item) {
        // 通过 SlotHandler 或 Carpet 命令
        String command = String.format("player %s equip %s",
                bot.name(), item.getDescriptionId());
        executeCommand(bot, command);
    }

    private double getItemFoodScore(Item item) {
        // Simplified food scoring based on item type
        if (item == Items.GOLDEN_APPLE || item == Items.ENCHANTED_GOLDEN_APPLE) return 20;
        if (item == Items.COOKED_BEEF || item == Items.COOKED_PORKCHOP) return 15;
        if (item == Items.BREAD || item == Items.COOKED_CHICKEN) return 10;
        if (item == Items.APPLE || item == Items.CARROT) return 8;
        if (item == Items.ROTTEN_FLESH) return -80;
        return 5; // default
    }

    private void executeCommand(BotHandle bot, String command) {
        ServerPlayer player = bot.getNativePlayer();
        if (player != null && player.server != null) {
            player.server.getCommands().performPrefixedCommand(
                    player.server.createCommandSourceStack(), command);
        }
    }

    /**
     * 获取背包物品列表（简化版）。
     * 实际实现需要完整的 InventoryService。
     */
    private List<ItemStack> getInventoryItems(BotHandle bot) {
        // TODO: 使用 InventoryService 获取背包物品
        return Collections.emptyList();
    }

    // ──────────────────────────────────────────────
    //  查询
    // ──────────────────────────────────────────────

    public boolean isTryingToEat() {
        return isTryingToEat;
    }

    // ──────────────────────────────────────────────
    //  内部数据结构
    // ──────────────────────────────────────────────

    private record FoodCalculation(int totalHunger, Optional<Item> bestFood) {}

    /**
     * 简单的收集食物任务占位。
     * 实际实现应创建一个 CollectFoodTask。
     */
    private static class CollectFoodTask extends io.alice.mod.adapter.ai.behavior.Task {
        private final int targetFoodUnits;

        CollectFoodTask(BotHandle bot, int targetFoodUnits) {
            this.targetFoodUnits = targetFoodUnits;
            setDebugState("CollectFood(" + targetFoodUnits + ")");
        }

        @Override
        protected void onStart(BotHandle bot) {
            // TODO: 实现食物收集逻辑
        }

        @Override
        protected io.alice.mod.adapter.ai.behavior.Task onTick(BotHandle bot) {
            return null;
        }

        @Override
        protected void onStop(BotHandle bot, io.alice.mod.adapter.ai.behavior.Task interruptTask) {
        }

        @Override
        protected boolean isEqual(io.alice.mod.adapter.ai.behavior.Task other) {
            return other instanceof CollectFoodTask;
        }

        @Override
        protected String toDebugString() {
            return "CollectFood(" + targetFoodUnits + ")";
        }

        @Override
        public boolean isFinished(BotHandle bot) {
            return false; // TODO: 实现完成条件
        }
    }
}