package io.alice.mod.adapter.api;

import java.util.Map;

/**
 * Alice Mod 工具接口 —— 所有工具的通用契约。
 * <p>
 * 工具名、描述、参数 Schema、执行入口。
 * 接口刻意不绑定任何 Minecraft 概念，保持通用性。
 */
public interface AliceTool {

    /**
     * 工具名称，snake_case，全局唯一。
     * 例如：{@code move_to}、{@code mine_block}、{@code look_around}
     */
    String name();

    /**
     * 工具描述，供 LLM 理解工具用途。
     */
    String description();

    /**
     * JSON Schema 格式的参数定义。
     * 返回的 Map 结构遵循 JSON Schema（OpenAI tool-parameter 方言）：
     * <pre>
     * {
     *   "type": "object",
     *   "properties": { ... },
     *   "required": ["x", "y", "z"]
     * }
     * </pre>
     */
    Map<String, Object> parameterSchema();

    /**
     * 执行工具。
     *
     * @param args 参数键值对（已校验）
     * @return 工具执行结果
     */
    ToolResult invoke(Map<String, Object> args);
}
