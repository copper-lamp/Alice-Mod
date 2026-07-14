package io.alice.mod.adapter.tool;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonObject;

import java.util.Map;

/**
 * 工具执行结果信封。
 * <p>
 * 标准化工具返回格式，供 Agent Core 解析并注入 LLM 上下文。
 * 设计参照业界通用的工具结果模式：成功/失败 + 消息 + 结构化数据。
 */
public record ToolResult(
        boolean success,
        String message,
        Map<String, Object> data
) {

    private static final Gson GSON = new GsonBuilder().disableHtmlEscaping().create();

    /** 创建成功结果。 */
    public static ToolResult ok(String message) {
        return new ToolResult(true, message, Map.of());
    }

    /** 创建成功结果（含结构化数据）。 */
    public static ToolResult ok(String message, Map<String, Object> data) {
        return new ToolResult(true, message, data);
    }

    /** 创建失败结果。 */
    public static ToolResult fail(String message) {
        return new ToolResult(false, message, Map.of());
    }

    /** 创建失败结果（含结构化错误信息）。 */
    public static ToolResult fail(String message, Map<String, Object> data) {
        return new ToolResult(false, message, data);
    }

    /**
     * 序列化为 LLM 可读的 JSON 字符串。
     * <p>
     * 输出格式：
     * <pre>
     * {"success":true,"message":"...","data":{...}}
     * </pre>
     */
    public String toJson() {
        JsonObject root = new JsonObject();
        root.addProperty("success", success);
        root.addProperty("message", message != null ? message : "");

        if (data != null && !data.isEmpty()) {
            JsonObject dataObj = new JsonObject();
            for (Map.Entry<String, Object> entry : data.entrySet()) {
                Object v = entry.getValue();
                if (v instanceof Number n) dataObj.addProperty(entry.getKey(), n);
                else if (v instanceof Boolean b) dataObj.addProperty(entry.getKey(), b);
                else if (v != null) dataObj.addProperty(entry.getKey(), v.toString());
            }
            root.add("data", dataObj);
        }

        return GSON.toJson(root);
    }
}
