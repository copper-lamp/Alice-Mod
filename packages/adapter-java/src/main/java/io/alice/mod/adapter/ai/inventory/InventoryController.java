package io.alice.mod.adapter.ai.inventory;

import io.alice.mod.adapter.ai.BotAccess;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.player.Inventory;
import net.minecraft.world.item.ItemStack;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.HashMap;
import java.util.Map;
import java.util.function.Predicate;

/**
 * 背包 AI 控制器——提供背包操作能力。
 */
public final class InventoryController {

    private static final Logger LOG = LoggerFactory.getLogger(InventoryController.class);

    private InventoryController() {}

    /**
     * 丢弃物品。
     */
    public static InventoryResult dropItem(String itemName, int count, String targetEntity) {
        ServerPlayer bot = BotAccess.getBot();
        if (bot == null) {
            return new InventoryResult(false, "Bot 未找到", null);
        }

        try {
            Inventory inventory = bot.getInventory();
            
            // 查找物品
            int slot = findItemInInventory(inventory, itemName);
            if (slot == -1) {
                return new InventoryResult(false, "背包中没有找到: " + itemName, null);
            }

            ItemStack stack = inventory.getItem(slot);
            int dropCount = Math.min(count, stack.getCount());
            
            // 丢弃物品
            ItemStack dropped = stack.split(dropCount);
            bot.drop(dropped, false);

            Map<String, Object> data = new HashMap<>();
            data.put("item", itemName);
            data.put("count", dropCount);

            return new InventoryResult(true, 
                    String.format("已丢弃 %s x%d", itemName, dropCount), 
                    data);
        } catch (Exception e) {
            LOG.error("Failed to drop item", e);
            return new InventoryResult(false, "丢弃失败: " + e.getMessage(), null);
        }
    }

    /**
     * 装备物品。
     */
    public static InventoryResult equipItem(String itemName, String slot, String action) {
        ServerPlayer bot = BotAccess.getBot();
        if (bot == null) {
            return new InventoryResult(false, "Bot 未找到", null);
        }

        try {
            Inventory inventory = bot.getInventory();
            
            // 查找物品
            int itemSlot = findItemInInventory(inventory, itemName);
            if (itemSlot == -1) {
                return new InventoryResult(false, "背包中没有找到: " + itemName, null);
            }

            ItemStack stack = inventory.getItem(itemSlot);
            
            // 根据槽位类型装备
            switch (slot != null ? slot : "hand") {
                case "hand":
                    // 移动到主手
                    inventory.setItem(0, stack);
                    break;
                case "offhand":
                    // 移动到副手
                    inventory.setItem(40, stack);
                    break;
                case "head":
                    // 移动到头盔槽
                    inventory.armor.set(3, stack);
                    break;
                case "chest":
                    // 移动到胸甲槽
                    inventory.armor.set(2, stack);
                    break;
                case "legs":
                    // 移动到腿甲槽
                    inventory.armor.set(1, stack);
                    break;
                case "feet":
                    // 移动到靴子槽
                    inventory.armor.set(0, stack);
                    break;
                default:
                    return new InventoryResult(false, "无效的槽位: " + slot, null);
            }

            Map<String, Object> data = new HashMap<>();
            data.put("item", itemName);
            data.put("slot", slot);

            return new InventoryResult(true, 
                    String.format("已装备 %s 到 %s", itemName, slot), 
                    data);
        } catch (Exception e) {
            LOG.error("Failed to equip item", e);
            return new InventoryResult(false, "装备失败: " + e.getMessage(), null);
        }
    }

    /**
     * 从容器取物品。
     */
    public static InventoryResult takeFromContainer(int x, int y, int z, String itemName, int count) {
        ServerPlayer bot = BotAccess.getBot();
        if (bot == null) {
            return new InventoryResult(false, "Bot 未找到", null);
        }

        // TODO: 实现容器交互（需要访问 Container 接口）
        return new InventoryResult(false, "容器交互暂未实现", null);
    }

    /**
     * 向容器放物品。
     */
    public static InventoryResult putToContainer(int x, int y, int z, String itemName, int count) {
        ServerPlayer bot = BotAccess.getBot();
        if (bot == null) {
            return new InventoryResult(false, "Bot 未找到", null);
        }

        // TODO: 实现容器交互（需要访问 Container 接口）
        return new InventoryResult(false, "容器交互暂未实现", null);
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

    public record InventoryResult(boolean success, String message, Map<String, Object> data) {}
}
