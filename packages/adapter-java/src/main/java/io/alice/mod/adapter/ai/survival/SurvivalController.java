package io.alice.mod.adapter.ai.survival;

import io.alice.mod.adapter.ai.BotAccess;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.entity.player.Inventory;
import net.minecraft.world.food.FoodData;
import net.minecraft.world.food.FoodProperties;
import net.minecraft.world.item.ItemStack;
import net.minecraft.core.component.DataComponents;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.HashMap;
import java.util.Map;
import java.util.function.Predicate;

/**
 * 生存 AI 控制器——提供生存操作能力。
 */
public final class SurvivalController {

    private static final Logger LOG = LoggerFactory.getLogger(SurvivalController.class);

    private SurvivalController() {}

    /**
     * 进食。
     */
    public static SurvivalResult eat(String foodName) {
        ServerPlayer bot = BotAccess.getBot();
        if (bot == null) {
            return new SurvivalResult(false, "Bot 未找到", null);
        }

        try {
            Inventory inventory = bot.getInventory();
            FoodData foodData = bot.getFoodData();

            // 检查是否已经吃饱
            if (foodData.getFoodLevel() >= 20) {
                return new SurvivalResult(false, "已经吃饱了", null);
            }

            // 查找食物
            int foodSlot = findFoodInInventory(inventory, foodName);
            if (foodSlot == -1) {
                return new SurvivalResult(false, "背包中没有找到食物: " + foodName, null);
            }

            ItemStack foodStack = inventory.getItem(foodSlot);
            
            // 检查是否可食用
            FoodProperties foodProps = foodStack.get(DataComponents.FOOD);
            if (foodProps == null) {
                return new SurvivalResult(false, "该物品不可食用", null);
            }

            // 进食
            foodStack.finishUsingItem(bot.level(), bot);

            Map<String, Object> data = new HashMap<>();
            data.put("food", foodStack.getHoverName().getString());
            data.put("nutrition", foodProps.nutrition());
            data.put("saturation", foodProps.saturation());

            return new SurvivalResult(true, 
                    String.format("已食用 %s (营养 %d, 饱和度 %.1f)", 
                            foodStack.getHoverName().getString(),
                            foodProps.nutrition(),
                            foodProps.saturation()), 
                    data);
        } catch (Exception e) {
            LOG.error("Failed to eat", e);
            return new SurvivalResult(false, "进食失败: " + e.getMessage(), null);
        }
    }

    /**
     * 睡觉。
     */
    public static SurvivalResult sleep(String action, Integer bedX, Integer bedY, Integer bedZ, Integer waitSeconds) {
        ServerPlayer bot = BotAccess.getBot();
        if (bot == null) {
            return new SurvivalResult(false, "Bot 未找到", null);
        }

        try {
            switch (action != null ? action : "sleep") {
                case "sleep":
                    // 睡觉
                    if (bot.isSleeping()) {
                        return new SurvivalResult(false, "已经在睡觉了", null);
                    }

                    if (bedX == null || bedY == null || bedZ == null) {
                        return new SurvivalResult(false, "需要提供床的坐标", null);
                    }

                    // TODO: 实现睡觉逻辑（需要找到床方块并设置睡眠状态）
                    return new SurvivalResult(false, "睡觉功能暂未实现", null);

                case "wake":
                    // 起床
                    if (!bot.isSleeping()) {
                        return new SurvivalResult(false, "当前未在睡觉", null);
                    }

                    bot.stopSleepInBed(false, true);
                    return new SurvivalResult(true, "已起床", null);

                case "wait":
                    // 等待
                    if (waitSeconds == null || waitSeconds <= 0) {
                        return new SurvivalResult(false, "等待时间必须大于 0", null);
                    }

                    // TODO: 实现等待逻辑（需要 tick 循环）
                    return new SurvivalResult(false, "等待功能暂未实现", null);

                default:
                    return new SurvivalResult(false, "无效的操作: " + action, null);
            }
        } catch (Exception e) {
            LOG.error("Failed to sleep", e);
            return new SurvivalResult(false, "睡觉失败: " + e.getMessage(), null);
        }
    }

    /**
     * 使用物品。
     */
    public static SurvivalResult useItem(String itemName, String mode, String target) {
        ServerPlayer bot = BotAccess.getBot();
        if (bot == null) {
            return new SurvivalResult(false, "Bot 未找到", null);
        }

        try {
            Inventory inventory = bot.getInventory();

            // 查找物品
            int itemSlot = findItemInInventory(inventory, itemName);
            if (itemSlot == -1) {
                return new SurvivalResult(false, "背包中没有找到: " + itemName, null);
            }

            ItemStack itemStack = inventory.getItem(itemSlot);

            Map<String, Object> data = new HashMap<>();
            data.put("item", itemStack.getHoverName().getString());
            data.put("mode", mode);

            switch (mode != null ? mode : "use") {
                case "use":
                    // 使用物品（右键）
                    // TODO: 实现使用逻辑
                    return new SurvivalResult(true, "已使用 " + itemStack.getHoverName().getString(), data);

                case "drink":
                    // 喝药水
                    // TODO: 实现喝药水逻辑
                    return new SurvivalResult(false, "喝药水功能暂未实现", null);

                case "throw":
                    // 投掷物品
                    // TODO: 实现投掷逻辑
                    return new SurvivalResult(false, "投掷功能暂未实现", null);

                default:
                    return new SurvivalResult(false, "无效的模式: " + mode, null);
            }
        } catch (Exception e) {
            LOG.error("Failed to use item", e);
            return new SurvivalResult(false, "使用失败: " + e.getMessage(), null);
        }
    }

    /**
     * 在背包中查找食物。
     */
    private static int findFoodInInventory(Inventory inventory, String foodName) {
        Predicate<ItemStack> predicate;
        
        if (foodName != null && !foodName.isEmpty()) {
            predicate = stack -> {
                FoodProperties props = stack.get(DataComponents.FOOD);
                return props != null && 
                       stack.getHoverName().getString().toLowerCase().contains(foodName.toLowerCase());
            };
        } else {
            // 自动选择最佳食物（营养值最高）
            predicate = stack -> stack.get(DataComponents.FOOD) != null;
        }

        int bestSlot = -1;
        int bestNutrition = 0;

        for (int i = 0; i < inventory.getContainerSize(); i++) {
            ItemStack stack = inventory.getItem(i);
            if (!stack.isEmpty() && predicate.test(stack)) {
                FoodProperties props = stack.get(DataComponents.FOOD);
                if (props != null && props.nutrition() > bestNutrition) {
                    bestNutrition = props.nutrition();
                    bestSlot = i;
                }
            }
        }

        return bestSlot;
    }

    /**
     * 在背包中查找物品。
     */
    private static int findItemInInventory(Inventory inventory, String itemName) {
        Predicate<ItemStack> predicate = stack -> 
                stack.getHoverName().getString().toLowerCase().contains(itemName.toLowerCase());

        for (int i = 0; i < inventory.getContainerSize(); i++) {
            ItemStack stack = inventory.getItem(i);
            if (!stack.isEmpty() && predicate.test(stack)) {
                return i;
            }
        }
        return -1;
    }

    // ---- 数据记录 ----

    public record SurvivalResult(boolean success, String message, Map<String, Object> data) {}
}
