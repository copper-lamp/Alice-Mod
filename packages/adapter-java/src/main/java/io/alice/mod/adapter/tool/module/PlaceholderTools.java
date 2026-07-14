package io.alice.mod.adapter.tool.module;

import io.alice.mod.adapter.tool.ToolResult;
import io.alice.mod.adapter.tool.annotation.ToolMethod;
import io.alice.mod.adapter.tool.annotation.ToolModule;
import io.alice.mod.adapter.tool.annotation.ToolParam;

import java.util.Map;

/**
 * 占位工具模块——用于验证 V3 工具注册流程。
 * <p>
 * 后续版本会被各分类的实际工具模块替换。
 */
@ToolModule(category = "movement", description = "移动类工具（占位）")
public enum PlaceholderTools {
    INSTANCE;

    @ToolMethod(
            name = "move_to",
            description = "走到指定坐标位置（占位，待 V4 实现）",
            parameters = {
                    @ToolParam(name = "x", type = "number", description = "目标 X 坐标"),
                    @ToolParam(name = "y", type = "number", description = "目标 Y 坐标"),
                    @ToolParam(name = "z", type = "number", description = "目标 Z 坐标"),
                    @ToolParam(name = "dimension", type = "string",
                            description = "维度", required = false)
            }
    )
    public ToolResult moveTo(Map<String, Object> params) {
        return ToolResult.ok("move_to placeholder: " + params);
    }

    @ToolMethod(
            name = "look_around",
            description = "查询附近实体/方块（占位，待 V8 实现）",
            parameters = {
                    @ToolParam(name = "filter", type = "string",
                            description = "过滤类型: entity/block/item", required = false),
                    @ToolParam(name = "radius", type = "number",
                            description = "搜索半径", required = false)
            }
    )
    public ToolResult lookAround(Map<String, Object> params) {
        return ToolResult.ok("look_around placeholder: " + params);
    }

    @ToolMethod(
            name = "chat",
            description = "发送公共聊天消息（占位，待 V9 实现）",
            parameters = {
                    @ToolParam(name = "message", type = "string", description = "消息内容"),
                    @ToolParam(name = "mode", type = "string",
                            description = "模式: chat/broadcast/emote", required = false)
            }
    )
    public ToolResult chat(Map<String, Object> params) {
        return ToolResult.ok("chat placeholder: " + params);
    }
}
