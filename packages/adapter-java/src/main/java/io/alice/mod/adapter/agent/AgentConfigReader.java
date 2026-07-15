package io.alice.mod.adapter.agent;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonDeserializationContext;
import com.google.gson.JsonDeserializer;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParseException;
import io.alice.mod.adapter.config.AlicePaths;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.lang.reflect.Type;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Optional;

/**
 * 智能体配置文件读取器。
 *
 * <p>从 Alice/agents/ 目录读取 AC 导出的智能体配置文件（JSON 格式），
 * 解析为 {@link AgentConfig} 对象。
 *
 * <p>文件命名规则：{@code <agentId>.json}
 * 文件格式由 AC 的 AgentFileExporter 定义。
 */
public final class AgentConfigReader {

    private static final Logger LOG = LoggerFactory.getLogger(AgentConfigReader.class);

    /** JSON 文件扩展名。 */
    private static final String JSON_EXT = ".json";

    /** 支持的文件 schema 版本。 */
    private static final String SUPPORTED_SCHEMA_VERSION = "1.0";

    private static final Gson GSON = new GsonBuilder()
            .disableHtmlEscaping()
            .create();

    private AgentConfigReader() {}

    /**
     * 读取 Alice/agents/ 目录下所有智能体配置文件。
     *
     * @param gameDir 游戏根目录
     * @return 智能体配置列表，目录不存在或为空时返回空列表
     */
    public static List<AgentConfig> readAll(Path gameDir) {
        Path agentsDir = AlicePaths.agentsDir(gameDir);
        if (!Files.isDirectory(agentsDir)) {
            LOG.debug("Agent config directory does not exist: {}", agentsDir);
            return Collections.emptyList();
        }

        List<AgentConfig> result = new ArrayList<>();
        try (DirectoryStream<Path> stream = Files.newDirectoryStream(agentsDir, "*" + JSON_EXT)) {
            for (Path file : stream) {
                try {
                    readFile(file).ifPresent(result::add);
                } catch (Exception e) {
                    LOG.warn("Failed to read agent config file: {} - {}", file, e.getMessage());
                }
            }
        } catch (IOException e) {
            LOG.warn("Failed to list agent config directory: {}", agentsDir, e);
        }

        LOG.info("Loaded {} agent configs from {}", result.size(), agentsDir);
        return result;
    }

    /**
     * 读取单个智能体配置文件。
     *
     * @param gameDir  游戏根目录
     * @param agentId  智能体 ID
     * @return 智能体配置，文件不存在时返回 empty
     */
    public static Optional<AgentConfig> read(Path gameDir, String agentId) {
        Path filePath = AlicePaths.agentsDir(gameDir).resolve(agentId + JSON_EXT);
        if (!Files.exists(filePath)) {
            return Optional.empty();
        }
        return readFile(filePath);
    }

    /**
     * 读取并解析单个 JSON 文件。
     */
    private static Optional<AgentConfig> readFile(Path filePath) {
        try {
            String content = Files.readString(filePath);
            JsonObject root = GSON.fromJson(content, JsonObject.class);
            if (root == null) {
                LOG.warn("Empty agent config file: {}", filePath);
                return Optional.empty();
            }

            // 校验 schema 版本
            String schemaVersion = getString(root, "schema_version");
            if (!SUPPORTED_SCHEMA_VERSION.equals(schemaVersion)) {
                LOG.warn("Unsupported schema version '{}' in file: {}", schemaVersion, filePath);
                return Optional.empty();
            }

            AgentConfig config = parseAgentConfig(root);
            return Optional.of(config);
        } catch (IOException e) {
            LOG.warn("Failed to read agent config file: {} - {}", filePath, e.getMessage());
            return Optional.empty();
        }
    }

    /**
     * 从 JSON 根对象解析 AgentConfig。
     */
    private static AgentConfig parseAgentConfig(JsonObject root) {
        return new AgentConfig(
                getString(root, "agent_id"),
                getString(root, "name"),
                getStringOrNull(root, "alias"),
                getStringOrNull(root, "skin_data"),
                parsePersona(root.getAsJsonObject("persona")),
                getStringOrNull(root, "persona_preset_id"),
                parseTools(root.getAsJsonObject("tools")),
                parseQQBinding(root.getAsJsonObject("qq_binding")),
                parseLLMConfig(root.getAsJsonObject("llm_config")),
                getBool(root, "is_main", false),
                getStringOrNull(root, "workspace_id"),
                getLong(root, "created_at", 0),
                getLong(root, "updated_at", 0)
        );
    }

    /**
     * 解析人设配置。
     */
    private static AgentConfig.PersonaConfig parsePersona(JsonObject persona) {
        if (persona == null) return null;

        return new AgentConfig.PersonaConfig(
                getString(persona, "identity"),
                getStringList(persona, "expertise"),
                getStringList(persona, "personality"),
                getString(persona, "workflow_id"),
                parseBehaviorRules(persona.getAsJsonObject("behavior_rules"))
        );
    }

    /**
     * 解析行为规则。
     */
    private static AgentConfig.BehaviorRules parseBehaviorRules(JsonObject rules) {
        if (rules == null) return null;

        List<AgentConfig.StrategyRule> strategyList = new ArrayList<>();
        if (rules.has("strategy")) {
            for (JsonElement e : rules.getAsJsonArray("strategy")) {
                JsonObject s = e.getAsJsonObject();
                strategyList.add(new AgentConfig.StrategyRule(
                        getString(s, "name"),
                        getString(s, "description"),
                        getInt(s, "priority", 0)
                ));
            }
        }

        List<AgentConfig.ConstraintRule> constraintList = new ArrayList<>();
        if (rules.has("constraints")) {
            for (JsonElement e : rules.getAsJsonArray("constraints")) {
                JsonObject c = e.getAsJsonObject();
                constraintList.add(new AgentConfig.ConstraintRule(
                        getString(c, "name"),
                        getString(c, "description"),
                        getString(c, "consequence")
                ));
            }
        }

        return new AgentConfig.BehaviorRules(
                getStringList(rules, "core"),
                strategyList,
                constraintList
        );
    }

    /**
     * 解析工具配置。
     */
    private static AgentConfig.ToolConfig parseTools(JsonObject tools) {
        if (tools == null) return null;

        java.util.Map<String, Boolean> enabledTools = new java.util.LinkedHashMap<>();
        if (tools.has("enabled_tools")) {
            JsonObject et = tools.getAsJsonObject("enabled_tools");
            for (String key : et.keySet()) {
                enabledTools.put(key, et.get(key).getAsBoolean());
            }
        }
        return new AgentConfig.ToolConfig(enabledTools);
    }

    /**
     * 解析 QQ 绑定配置。
     */
    private static AgentConfig.QQBindingConfig parseQQBinding(JsonObject qq) {
        if (qq == null) return null;

        return new AgentConfig.QQBindingConfig(
                getBool(qq, "enabled", false),
                getStringOrNull(qq, "account_id"),
                getStringListOrNull(qq, "group_ids")
        );
    }

    /**
     * 解析 LLM 模型配置。
     */
    private static AgentConfig.LLMConfig parseLLMConfig(JsonObject llm) {
        if (llm == null) return null;

        return new AgentConfig.LLMConfig(
                parseModelSelection(llm.getAsJsonObject("main_model")),
                parseModelSelection(llm.getAsJsonObject("qq_bot_model")),
                parseModelSelection(llm.getAsJsonObject("compression_model"))
        );
    }

    /**
     * 解析模型选择。
     */
    private static AgentConfig.ModelSelection parseModelSelection(JsonObject model) {
        if (model == null) return null;

        return new AgentConfig.ModelSelection(
                getStringOrNull(model, "provider_id"),
                getStringOrNull(model, "model_id"),
                getStringOrNull(model, "model_name"),
                getBool(model, "same_as_main", false)
        );
    }

    // ── JSON 辅助方法 ──

    private static String getString(JsonObject obj, String key) {
        return obj.has(key) ? obj.get(key).getAsString() : "";
    }

    private static String getStringOrNull(JsonObject obj, String key) {
        if (obj == null || !obj.has(key) || obj.get(key).isJsonNull()) return null;
        return obj.get(key).getAsString();
    }

    private static boolean getBool(JsonObject obj, String key, boolean defaultValue) {
        return obj.has(key) && !obj.get(key).isJsonNull() ? obj.get(key).getAsBoolean() : defaultValue;
    }

    private static int getInt(JsonObject obj, String key, int defaultValue) {
        return obj.has(key) && !obj.get(key).isJsonNull() ? obj.get(key).getAsInt() : defaultValue;
    }

    private static long getLong(JsonObject obj, String key, long defaultValue) {
        return obj.has(key) && !obj.get(key).isJsonNull() ? obj.get(key).getAsLong() : defaultValue;
    }

    private static List<String> getStringList(JsonObject obj, String key) {
        if (!obj.has(key) || !obj.get(key).isJsonArray()) return List.of();
        List<String> result = new ArrayList<>();
        for (JsonElement e : obj.getAsJsonArray(key)) {
            result.add(e.getAsString());
        }
        return result;
    }

    private static List<String> getStringListOrNull(JsonObject obj, String key) {
        if (!obj.has(key) || obj.get(key).isJsonNull()) return null;
        return getStringList(obj, key);
    }
}