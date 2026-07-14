package io.alice.mod.adapter.tool.inventory;

import io.alice.mod.adapter.ai.inventory.InventoryController;
import io.alice.mod.adapter.tool.ToolResult;
import io.alice.mod.adapter.tool.annotation.ToolMethod;
import io.alice.mod.adapter.tool.annotation.ToolModule;
import io.alice.mod.adapter.tool.annotation.ToolParam;

import java.util.Map;

/**
 * 背包工具模块——提供背包操作能力。
 */
@ToolModule(category = "inventory", description = "背包类工具")
public enum InventoryTools {
    INSTANCE;

    @ToolMethod(
            name = "drop_item",
            description = "丢弃物品",
            parameters = {
                    @ToolParam(name = "item_name", type = "string", description = "物品名称", required = false),
                    @ToolParam(name = "count", type = "number", description = "丢弃数量", required = false),
                    @ToolParam(name = "target_entity", type = "string", description = "目标实体（丢给谁）", required = false)
            }
    )
    public ToolResult dropItem(Map<String, Object> params) {
        long start = System.currentTimeMillis();
        try {
            String itemName = (String) params.get("item_name");
            int count = params.containsKey("count") ? ((Number) params.get("count")).intValue() : 1;
            String targetEntity = (String) params.get("target_entity");

            var result = InventoryController.dropItem(itemName, count, targetEntity);
            if (result.success()) {
                return ToolResult.ok(result.message(), result.data(), start);
            } else {
                return ToolResult.fail("DROP_FAILED", result.message(), start);
            }
        } catch (Exception e) {
            return ToolResult.fail("INTERNAL_ERROR", e.getMessage(), start);
        }
    }

    @ToolMethod(
            name = "take_from_container",
            description = "从容器取物品",
            parameters = {
                    @ToolParam(name = "x", type = "number", description = "容器 X 坐标"),
                    @ToolParam(name = "y", type = "number", description = "容器 Y 坐标"),
                    @ToolParam(name = "z", type = "number", description = "容器 Z 坐标"),
                    @ToolParam(name = "item_name", type = "string", description = "物品名称", required = false),
                    @ToolParam(name = "count", type = "number", description = "取物数量", required = false)
            }
    )
    public ToolResult takeFromContainer(Map<String, Object> params) {
        long start = System.currentTimeMillis();
        try {
            int x = ((Number) params.get("x")).intValue();
            int y = ((Number) params.get("y")).intValue();
            int z = ((Number) params.get("z")).intValue();
            String itemName = (String) params.get("item_name");
            int count = params.containsKey("count") ? ((Number) params.get("count")).intValue() : 1;

            var result = InventoryController.takeFromContainer(x, y, z, itemName, count);
            if (result.success()) {
                return ToolResult.ok(result.message(), result.data(), start);
            } else {
                return ToolResult.fail("TAKE_FAILED", result.message(), start);
            }
        } catch (Exception e) {
            return ToolResult.fail("INTERNAL_ERROR", e.getMessage(), start);
        }
    }

    @ToolMethod(
            name = "put_to_container",
            description = "向容器放物品",
            parameters = {
                    @ToolParam(name = "x", type = "number", description = "容器 X 坐标"),
                    @ToolParam(name = "y", type = "number", description = "容器 Y 坐标"),
                    @ToolParam(name = "z", type = "number", description = "容器 Z 坐标"),
                    @ToolParam(name = "item_name", type = "string", description = "物品名称", required = false),
                    @ToolParam(name = "count", type = "number", description = "放物数量", required = false)
            }
    )
    public ToolResult putToContainer(Map<String, Object> params) {
        long start = System.currentTimeMillis();
        try {
            int x = ((Number) params.get("x")).intValue();
            int y = ((Number) params.get("y")).intValue();
            int z = ((Number) params.get("z")).intValue();
            String itemName = (String) params.get("item_name");
            int count = params.containsKey("count") ? ((Number) params.get("count")).intValue() : 1;

            var result = InventoryController.putToContainer(x, y, z, itemName, count);
            if (result.success()) {
                return ToolResult.ok(result.message(), result.data(), start);
            } else {
                return ToolResult.fail("PUT_FAILED", result.message(), start);
            }
        } catch (Exception e) {
            return ToolResult.fail("INTERNAL_ERROR", e.getMessage(), start);
        }
    }

    @ToolMethod(
            name = "equip_item",
            description = "装备物品",
            parameters = {
                    @ToolParam(name = "item_name", type = "string", description = "物品名称"),
                    @ToolParam(name = "slot", type = "string", description = "槽位: hand/offhand/head/chest/legs/feet", required = false),
                    @ToolParam(name = "action", type = "string", description = "操作: equip/unequip", required = false)
            }
    )
    public ToolResult equipItem(Map<String, Object> params) {
        long start = System.currentTimeMillis();
        try {
            String itemName = (String) params.get("item_name");
            String slot = (String) params.get("slot");
            String action = (String) params.get("action");

            var result = InventoryController.equipItem(itemName, slot, action);
            if (result.success()) {
                return ToolResult.ok(result.message(), result.data(), start);
            } else {
                return ToolResult.fail("EQUIP_FAILED", result.message(), start);
            }
        } catch (Exception e) {
            return ToolResult.fail("INTERNAL_ERROR", e.getMessage(), start);
        }
    }
}
