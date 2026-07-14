package io.alice.mod.adapter.tool.survival;

import io.alice.mod.adapter.ai.survival.SurvivalController;
import io.alice.mod.adapter.tool.ToolResult;
import io.alice.mod.adapter.tool.annotation.ToolMethod;
import io.alice.mod.adapter.tool.annotation.ToolModule;
import io.alice.mod.adapter.tool.annotation.ToolParam;

import java.util.Map;

/**
 * 生存工具模块——提供生存操作能力。
 */
@ToolModule(category = "survival", description = "生存类工具")
public enum SurvivalTools {
    INSTANCE;

    @ToolMethod(
            name = "eat",
            description = "进食（自动选择最佳食物或指定食物）",
            parameters = {
                    @ToolParam(name = "food_name", type = "string", 
                            description = "食物名称（不传则自动选择最佳食物）", required = false)
            }
    )
    public ToolResult eat(Map<String, Object> params) {
        long start = System.currentTimeMillis();
        try {
            String foodName = (String) params.get("food_name");

            var result = SurvivalController.eat(foodName);
            if (result.success()) {
                return ToolResult.ok(result.message(), result.data(), start);
            } else {
                return ToolResult.fail("EAT_FAILED", result.message(), start);
            }
        } catch (Exception e) {
            return ToolResult.fail("INTERNAL_ERROR", e.getMessage(), start);
        }
    }

    @ToolMethod(
            name = "sleep",
            description = "睡觉/起床/等待",
            parameters = {
                    @ToolParam(name = "action", type = "string", 
                            description = "操作: sleep/wake/wait"),
                    @ToolParam(name = "bed_pos", type = "object", 
                            description = "床坐标: {x, y, z}（sleep 操作）", required = false),
                    @ToolParam(name = "wait_seconds", type = "number", 
                            description = "等待秒数（wait 操作）", required = false)
            }
    )
    public ToolResult sleep(Map<String, Object> params) {
        long start = System.currentTimeMillis();
        try {
            String action = (String) params.get("action");
            
            Integer bedX = null, bedY = null, bedZ = null;
            @SuppressWarnings("unchecked")
            Map<String, Object> bedPos = (Map<String, Object>) params.get("bed_pos");
            if (bedPos != null) {
                bedX = ((Number) bedPos.get("x")).intValue();
                bedY = ((Number) bedPos.get("y")).intValue();
                bedZ = ((Number) bedPos.get("z")).intValue();
            }
            
            Integer waitSeconds = params.containsKey("wait_seconds") 
                    ? ((Number) params.get("wait_seconds")).intValue() 
                    : null;

            var result = SurvivalController.sleep(action, bedX, bedY, bedZ, waitSeconds);
            if (result.success()) {
                return ToolResult.ok(result.message(), result.data(), start);
            } else {
                return ToolResult.fail("SLEEP_FAILED", result.message(), start);
            }
        } catch (Exception e) {
            return ToolResult.fail("INTERNAL_ERROR", e.getMessage(), start);
        }
    }

    @ToolMethod(
            name = "use_item",
            description = "使用物品（use/drink/throw 三种模式）",
            parameters = {
                    @ToolParam(name = "item_name", type = "string", description = "物品名称"),
                    @ToolParam(name = "mode", type = "string", 
                            description = "模式: use/drink/throw", required = false),
                    @ToolParam(name = "target", type = "string", 
                            description = "目标（throw 模式）", required = false)
            }
    )
    public ToolResult useItem(Map<String, Object> params) {
        long start = System.currentTimeMillis();
        try {
            String itemName = (String) params.get("item_name");
            String mode = (String) params.get("mode");
            String target = (String) params.get("target");

            var result = SurvivalController.useItem(itemName, mode, target);
            if (result.success()) {
                return ToolResult.ok(result.message(), result.data(), start);
            } else {
                return ToolResult.fail("USE_ITEM_FAILED", result.message(), start);
            }
        } catch (Exception e) {
            return ToolResult.fail("INTERNAL_ERROR", e.getMessage(), start);
        }
    }
}
