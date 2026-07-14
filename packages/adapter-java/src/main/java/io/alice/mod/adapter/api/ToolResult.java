package io.alice.mod.adapter.api;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;

import java.util.List;
import java.util.Map;

/**
 * 工具执行结果信封。
 * <p>
 * 标准化工具返回格式，供 Agent Core 解析并注入 LLM 上下文。
 * 格式符合 00-工具协议规范 §3 ResultEnvelope 标准。
 */
public record ToolResult(
        boolean success,
        String message,
        Map<String, Object> data,
        Map<String, Object> meta,
        String errorCode,
        String errorMessage,
        Map<String, Object> errorDetails
) {

    private static final Gson GSON = new GsonBuilder().disableHtmlEscaping().create();

    /** 创建成功结果（仅消息）。 */
    public static ToolResult ok(String message) {
        return new ToolResult(true, message, Map.of(), Map.of(), null, null, null);
    }

    /** 创建成功结果（含结构化数据）。 */
    public static ToolResult ok(String message, Map<String, Object> data) {
        return new ToolResult(true, message, data != null ? data : Map.of(), Map.of(), null, null, null);
    }

    /** 创建成功结果（含数据和自动计时）。 */
    public static ToolResult ok(String message, Map<String, Object> data, long startTime) {
        long duration = System.currentTimeMillis() - startTime;
        Map<String, Object> meta = Map.of("duration", duration);
        return new ToolResult(true, message, data != null ? data : Map.of(), meta, null, null, null);
    }

    /** 创建成功结果（含数据、资源消耗和自动计时）。 */
    public static ToolResult ok(String message, Map<String, Object> data, Map<String, Object> cost, long startTime) {
        long duration = System.currentTimeMillis() - startTime;
        Map<String, Object> meta = new java.util.HashMap<>();
        meta.put("duration", duration);
        if (cost != null && !cost.isEmpty()) {
            meta.put("cost", cost);
        }
        return new ToolResult(true, message, data != null ? data : Map.of(), meta, null, null, null);
    }

    /** 创建失败结果（仅消息）。 */
    public static ToolResult fail(String message) {
        return new ToolResult(false, message, Map.of(), Map.of(), "UNKNOWN_ERROR", message, null);
    }

    /** 创建失败结果（含错误码和消息）。 */
    public static ToolResult fail(String errorCode, String errorMessage) {
        return new ToolResult(false, errorMessage, Map.of(), Map.of(), errorCode, errorMessage, null);
    }

    /** 创建失败结果（含错误码、消息和自动计时）。 */
    public static ToolResult fail(String errorCode, String errorMessage, long startTime) {
        long duration = System.currentTimeMillis() - startTime;
        Map<String, Object> meta = Map.of("duration", duration);
        return new ToolResult(false, errorMessage, Map.of(), meta, errorCode, errorMessage, null);
    }

    /** 创建失败结果（含错误码、消息和详情）。 */
    public static ToolResult fail(String errorCode, String errorMessage, Map<String, Object> details) {
        return new ToolResult(false, errorMessage, Map.of(), Map.of(), errorCode, errorMessage, details);
    }

    /** 创建失败结果（含错误码、消息、详情和自动计时）。 */
    public static ToolResult fail(String errorCode, String errorMessage, Map<String, Object> details, long startTime) {
        long duration = System.currentTimeMillis() - startTime;
        Map<String, Object> meta = Map.of("duration", duration);
        return new ToolResult(false, errorMessage, Map.of(), meta, errorCode, errorMessage, details);
    }

    /**
     * 序列化为 LLM 可读的 JSON 字符串。
     */
    public String toJson() {
        JsonObject root = new JsonObject();
        root.addProperty("success", success);

        if (success) {
            JsonObject dataObj = new JsonObject();
            if (message != null && !message.isEmpty()) {
                dataObj.addProperty("message", message);
            }
            if (data != null) {
                for (Map.Entry<String, Object> entry : data.entrySet()) {
                    addJsonElement(dataObj, entry.getKey(), entry.getValue());
                }
            }
            root.add("data", dataObj);
        } else {
            JsonObject errorObj = new JsonObject();
            if (errorCode != null) {
                errorObj.addProperty("code", errorCode);
            }
            if (errorMessage != null) {
                errorObj.addProperty("message", errorMessage);
            }
            if (errorDetails != null && !errorDetails.isEmpty()) {
                JsonObject detailsObj = new JsonObject();
                for (Map.Entry<String, Object> entry : errorDetails.entrySet()) {
                    addJsonElement(detailsObj, entry.getKey(), entry.getValue());
                }
                errorObj.add("details", detailsObj);
            }
            root.add("error", errorObj);
        }

        if (meta != null && !meta.isEmpty()) {
            JsonObject metaObj = new JsonObject();
            for (Map.Entry<String, Object> entry : meta.entrySet()) {
                addJsonElement(metaObj, entry.getKey(), entry.getValue());
            }
            root.add("meta", metaObj);
        }

        return GSON.toJson(root);
    }

    private static void addJsonElement(JsonObject obj, String key, Object value) {
        if (value == null) return;
        if (value instanceof Number n) {
            obj.addProperty(key, n);
        } else if (value instanceof Boolean b) {
            obj.addProperty(key, b);
        } else if (value instanceof String s) {
            obj.addProperty(key, s);
        } else if (value instanceof Map<?, ?> map) {
            JsonObject nested = new JsonObject();
            for (Map.Entry<?, ?> entry : map.entrySet()) {
                addJsonElement(nested, entry.getKey().toString(), entry.getValue());
            }
            obj.add(key, nested);
        } else if (value instanceof List<?> list) {
            JsonArray array = new JsonArray();
            for (Object item : list) {
                if (item instanceof Number n) array.add(n);
                else if (item instanceof Boolean b) array.add(b);
                else if (item instanceof String s) array.add(s);
                else if (item instanceof Map<?, ?> map) {
                    JsonObject nested = new JsonObject();
                    for (Map.Entry<?, ?> entry : map.entrySet()) {
                        addJsonElement(nested, entry.getKey().toString(), entry.getValue());
                    }
                    array.add(nested);
                } else {
                    array.add(item.toString());
                }
            }
            obj.add(key, array);
        } else {
            obj.addProperty(key, value.toString());
        }
    }
}
