package io.alice.mod.adapter.tool.block;

import io.alice.mod.adapter.ai.inventory.BlockController;
import io.alice.mod.adapter.tool.ToolResult;
import io.alice.mod.adapter.tool.annotation.ToolMethod;
import io.alice.mod.adapter.tool.annotation.ToolModule;
import io.alice.mod.adapter.tool.annotation.ToolParam;

import java.util.HashMap;
import java.util.Map;

/**
 * 方块工具模块——提供方块操作能力。
 */
@ToolModule(category = "block", description = "方块类工具")
public enum BlockTools {
    INSTANCE;

    @ToolMethod(
            name = "mine_block",
            description = "挖掘方块",
            parameters = {
                    @ToolParam(name = "x", type = "number", description = "方块 X 坐标"),
                    @ToolParam(name = "y", type = "number", description = "方块 Y 坐标"),
                    @ToolParam(name = "z", type = "number", description = "方块 Z 坐标"),
                    @ToolParam(name = "options", type = "object", 
                            description = "选项: {silk_touch, tool}", required = false)
            }
    )
    public ToolResult mineBlock(Map<String, Object> params) {
        long start = System.currentTimeMillis();
        try {
            int x = ((Number) params.get("x")).intValue();
            int y = ((Number) params.get("y")).intValue();
            int z = ((Number) params.get("z")).intValue();

            @SuppressWarnings("unchecked")
            Map<String, Object> options = (Map<String, Object>) params.get("options");

            var result = BlockController.mineBlock(x, y, z, options);
            if (result.success()) {
                return ToolResult.ok(result.message(), result.data(), start);
            } else {
                return ToolResult.fail("MINE_FAILED", result.message(), start);
            }
        } catch (Exception e) {
            return ToolResult.fail("INTERNAL_ERROR", e.getMessage(), start);
        }
    }

    @ToolMethod(
            name = "place_block",
            description = "放置方块",
            parameters = {
                    @ToolParam(name = "x", type = "number", description = "方块 X 坐标"),
                    @ToolParam(name = "y", type = "number", description = "方块 Y 坐标"),
                    @ToolParam(name = "z", type = "number", description = "方块 Z 坐标"),
                    @ToolParam(name = "block_name", type = "string", description = "方块名称"),
                    @ToolParam(name = "facing", type = "string", 
                            description = "朝向: up/down/north/south/east/west", required = false)
            }
    )
    public ToolResult placeBlock(Map<String, Object> params) {
        long start = System.currentTimeMillis();
        try {
            int x = ((Number) params.get("x")).intValue();
            int y = ((Number) params.get("y")).intValue();
            int z = ((Number) params.get("z")).intValue();
            String blockName = (String) params.get("block_name");
            String facing = (String) params.get("facing");

            var result = BlockController.placeBlock(x, y, z, blockName, facing);
            if (result.success()) {
                return ToolResult.ok(result.message(), result.data(), start);
            } else {
                return ToolResult.fail("PLACE_FAILED", result.message(), start);
            }
        } catch (Exception e) {
            return ToolResult.fail("INTERNAL_ERROR", e.getMessage(), start);
        }
    }

    @ToolMethod(
            name = "use_block",
            description = "使用方块（右键点击）",
            parameters = {
                    @ToolParam(name = "x", type = "number", description = "方块 X 坐标"),
                    @ToolParam(name = "y", type = "number", description = "方块 Y 坐标"),
                    @ToolParam(name = "z", type = "number", description = "方块 Z 坐标")
            }
    )
    public ToolResult useBlock(Map<String, Object> params) {
        long start = System.currentTimeMillis();
        try {
            int x = ((Number) params.get("x")).intValue();
            int y = ((Number) params.get("y")).intValue();
            int z = ((Number) params.get("z")).intValue();

            var result = BlockController.useBlock(x, y, z);
            if (result.success()) {
                return ToolResult.ok(result.message(), result.data(), start);
            } else {
                return ToolResult.fail("USE_FAILED", result.message(), start);
            }
        } catch (Exception e) {
            return ToolResult.fail("INTERNAL_ERROR", e.getMessage(), start);
        }
    }

    @ToolMethod(
            name = "area_operation",
            description = "区域方块操作（fill/clear/break/vein 四种模式）",
            parameters = {
                    @ToolParam(name = "mode", type = "string", 
                            description = "操作模式: fill/clear/break/vein"),
                    @ToolParam(name = "from", type = "object", 
                            description = "起始坐标: {x, y, z}"),
                    @ToolParam(name = "to", type = "object", 
                            description = "结束坐标: {x, y, z}"),
                    @ToolParam(name = "block_name", type = "string", 
                            description = "方块名称（fill 模式）", required = false),
                    @ToolParam(name = "radius", type = "number", 
                            description = "矿脉扫描半径（vein 模式）", required = false)
            }
    )
    public ToolResult areaOperation(Map<String, Object> params) {
        long start = System.currentTimeMillis();
        try {
            String mode = (String) params.get("mode");
            
            @SuppressWarnings("unchecked")
            Map<String, Object> from = (Map<String, Object>) params.get("from");
            @SuppressWarnings("unchecked")
            Map<String, Object> to = (Map<String, Object>) params.get("to");
            
            int fromX = ((Number) from.get("x")).intValue();
            int fromY = ((Number) from.get("y")).intValue();
            int fromZ = ((Number) from.get("z")).intValue();
            
            int toX = ((Number) to.get("x")).intValue();
            int toY = ((Number) to.get("y")).intValue();
            int toZ = ((Number) to.get("z")).intValue();
            
            String blockName = (String) params.get("block_name");
            int radius = params.containsKey("radius") ? ((Number) params.get("radius")).intValue() : 8;

            var result = BlockController.areaOperation(mode, fromX, fromY, fromZ, toX, toY, toZ, blockName, radius);
            if (result.success()) {
                return ToolResult.ok(result.message(), result.data(), start);
            } else {
                return ToolResult.fail("AREA_OP_FAILED", result.message(), start);
            }
        } catch (Exception e) {
            return ToolResult.fail("INTERNAL_ERROR", e.getMessage(), start);
        }
    }
}
