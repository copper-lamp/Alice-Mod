package io.alice.mod.adapter.api.event;

import java.util.Map;

/**
 * 工具事件。
 * <p>
 * 事件类型：TOOL_CALLED / TOOL_COMPLETED
 */
public record ToolEvent(
        String type,
        long timestamp,
        String toolName,
        boolean success,
        long durationMs
) implements AliceEvent {

    @Override
    public Map<String, Object> data() {
        return Map.of(
                "tool_name", toolName,
                "success", success,
                "duration_ms", durationMs
        );
    }

    // 事件类型常量
    public static final String CALLED = "TOOL_CALLED";
    public static final String COMPLETED = "TOOL_COMPLETED";
}
