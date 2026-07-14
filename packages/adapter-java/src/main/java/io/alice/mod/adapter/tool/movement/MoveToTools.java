package io.alice.mod.adapter.tool.movement;

import io.alice.mod.adapter.ai.movement.MovementController;
import io.alice.mod.adapter.tool.ToolResult;
import io.alice.mod.adapter.tool.annotation.ToolMethod;
import io.alice.mod.adapter.tool.annotation.ToolModule;
import io.alice.mod.adapter.tool.annotation.ToolParam;

import java.util.Map;

/**
 * 移动工具模块——提供移动、跟随、骑乘等能力。
 */
@ToolModule(category = "movement", description = "移动类工具")
public enum MoveToTools {
    INSTANCE;

    @ToolMethod(
            name = "move_to",
            description = "移动到目标位置（支持坐标、实体跟随、高度调整）",
            parameters = {
                    @ToolParam(name = "x", type = "number", description = "目标 X 坐标", required = false),
                    @ToolParam(name = "y", type = "number", description = "目标 Y 坐标", required = false),
                    @ToolParam(name = "z", type = "number", description = "目标 Z 坐标", required = false),
                    @ToolParam(name = "entity", type = "string", description = "实体 ID（跟随模式）", required = false),
                    @ToolParam(name = "break", type = "boolean", description = "是否允许破坏方块", required = false),
                    @ToolParam(name = "distance", type = "number", description = "跟随距离", required = false)
            }
    )
    public ToolResult moveTo(Map<String, Object> params) {
        long start = System.currentTimeMillis();
        try {
            Double x = params.containsKey("x") ? ((Number) params.get("x")).doubleValue() : null;
            Double y = params.containsKey("y") ? ((Number) params.get("y")).doubleValue() : null;
            Double z = params.containsKey("z") ? ((Number) params.get("z")).doubleValue() : null;
            String entity = (String) params.get("entity");
            boolean allowBreak = Boolean.TRUE.equals(params.get("break"));
            int distance = params.containsKey("distance") ? ((Number) params.get("distance")).intValue() : 2;

            MovementController.MovementResult result;

            if (entity != null && !entity.isEmpty()) {
                // 跟随实体模式
                result = MovementController.followEntity(entity, distance, allowBreak);
            } else if (x != null && z != null) {
                // 坐标移动模式
                result = MovementController.moveTo(x, y, z, allowBreak);
            } else if (y != null && x == null && z == null) {
                // 高度调整模式
                result = MovementController.moveToHeight(y, allowBreak);
            } else {
                return ToolResult.fail("INVALID_PARAMS", 
                        "需要提供 x+z（去位置）、x+y+z（精确方块）、entity（实体）或 y（升降高度）", 
                        start);
            }

            if (result.success()) {
                return ToolResult.ok(result.message(), result.data(), start);
            } else {
                return ToolResult.fail("MOVEMENT_FAILED", result.message(), start);
            }
        } catch (Exception e) {
            return ToolResult.fail("INTERNAL_ERROR", e.getMessage(), start);
        }
    }

    @ToolMethod(
            name = "ride",
            description = "骑乘指定实体",
            parameters = {
                    @ToolParam(name = "entity_id", type = "string", description = "实体 UUID")
            }
    )
    public ToolResult ride(Map<String, Object> params) {
        long start = System.currentTimeMillis();
        try {
            String entityId = (String) params.get("entity_id");
            var result = MovementController.ride(entityId);

            if (result.success()) {
                return ToolResult.ok(result.message(), result.data(), start);
            } else {
                return ToolResult.fail("RIDE_FAILED", result.message(), start);
            }
        } catch (Exception e) {
            return ToolResult.fail("INTERNAL_ERROR", e.getMessage(), start);
        }
    }

    @ToolMethod(
            name = "dismount",
            description = "脱离骑乘",
            parameters = {}
    )
    public ToolResult dismount(Map<String, Object> params) {
        long start = System.currentTimeMillis();
        try {
            var result = MovementController.dismount();

            if (result.success()) {
                return ToolResult.ok(result.message(), result.data(), start);
            } else {
                return ToolResult.fail("DISMOUNT_FAILED", result.message(), start);
            }
        } catch (Exception e) {
            return ToolResult.fail("INTERNAL_ERROR", e.getMessage(), start);
        }
    }
}
