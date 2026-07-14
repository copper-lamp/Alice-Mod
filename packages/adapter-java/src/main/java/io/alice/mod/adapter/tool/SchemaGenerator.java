package io.alice.mod.adapter.tool;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;

import java.util.List;
import java.util.Map;

/**
 * 工具 JSON Schema 生成器。
 * <p>
 * 将 {@link AliceTool} 的元数据（名称、描述、参数 Schema）组装为
 * Agent Core 可识别的注册消息格式。
 */
public final class SchemaGenerator {

    private static final Gson GSON = new GsonBuilder()
            .disableHtmlEscaping()
            .setPrettyPrinting()
            .create();

    private SchemaGenerator() {}

    /**
     * 为单个工具生成注册消息中的 tool entry。
     *
     * @param tool 工具实例
     * @return JSON 对象，包含 name/description/category/input_schema/output_schema/execution
     */
    public static JsonObject generateToolEntry(AliceTool tool, String category) {
        JsonObject entry = new JsonObject();
        entry.addProperty("name", tool.name());
        entry.addProperty("description", tool.description());
        entry.addProperty("category", category);

        // input_schema
        Map<String, Object> schema = tool.parameterSchema();
        entry.add("input_schema", GSON.toJsonTree(schema));

        // output_schema (通用兜底)
        JsonObject outputSchema = new JsonObject();
        outputSchema.addProperty("type", "object");
        outputSchema.add("properties", new JsonObject());
        entry.add("output_schema", outputSchema);

        // execution metadata
        JsonObject execution = new JsonObject();
        execution.addProperty("timeout_default_ms", 30000);
        execution.addProperty("timeout_max_ms", 120000);
        execution.addProperty("is_movement", "movement".equals(category));
        execution.addProperty("is_async", false);
        entry.add("execution", execution);

        return entry;
    }

    /**
     * 生成完整的 {@code register_tools} 消息的 params 部分。
     *
     * @param tools 工具列表（已经按类别分组）
     * @return JSON 对象 `{"tools": [...]}`
     */
    public static JsonObject generateRegisterPayload(List<AliceTool> tools) {
        JsonArray toolsArray = new JsonArray();
        for (AliceTool tool : tools) {
            toolsArray.add(generateToolEntry(tool, inferCategory(tool)));
        }

        JsonObject payload = new JsonObject();
        payload.add("tools", toolsArray);
        return payload;
    }

    /**
     * 推断工具的分类（从参数 Schema 中的预定义字段）。
     * 暂返回空字符串，后续可由 {@link ToolModule} 注解提供。
     */
    private static String inferCategory(AliceTool tool) {
        // 工具分类将在后续版本中通过注解系统明确提供
        return "";
    }
}
