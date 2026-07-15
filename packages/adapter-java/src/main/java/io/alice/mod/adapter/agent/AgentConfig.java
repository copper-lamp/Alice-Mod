package io.alice.mod.adapter.agent;

import java.util.List;
import java.util.Map;

/**
 * 智能体配置 — 对应 AC 导出的 Alice/agents/&lt;agentId&gt;.json 文件。
 *
 * <p>该配置由 AC 的 AgentFileExporter 在创建/更新智能体时写入，
 * JE 侧通过 {@link AgentConfigReader} 读取并据此创建对应的假人实例。
 *
 * @param agentId          智能体 ID
 * @param name             智能体名称
 * @param alias            备注/别名
 * @param skinData         皮肤 base64
 * @param isMain           是否为 workspace 主智能体
 * @param workspaceId      所属 workspace ID
 * @param createdAt        创建时间戳
 * @param updatedAt        更新时间戳
 */
public record AgentConfig(
        String agentId,
        String name,
        String alias,
        String skinData,
        PersonaConfig persona,
        String personaPresetId,
        ToolConfig tools,
        QQBindingConfig qqBinding,
        LLMConfig llmConfig,
        boolean isMain,
        String workspaceId,
        long createdAt,
        long updatedAt
) {
    /** 人设配置 */
    public record PersonaConfig(
            String identity,
            List<String> expertise,
            List<String> personality,
            String workflowId,
            BehaviorRules behaviorRules
    ) {}

    /** 行为规则 */
    public record BehaviorRules(
            List<String> core,
            List<StrategyRule> strategy,
            List<ConstraintRule> constraints
    ) {}

    /** 策略规则 */
    public record StrategyRule(
            String name,
            String description,
            int priority
    ) {}

    /** 约束规则 */
    public record ConstraintRule(
            String name,
            String description,
            String consequence
    ) {}

    /** 工具配置 */
    public record ToolConfig(
            Map<String, Boolean> enabledTools
    ) {}

    /** QQ 绑定配置 */
    public record QQBindingConfig(
            boolean enabled,
            String accountId,
            List<String> groupIds
    ) {}

    /** LLM 模型配置 */
    public record LLMConfig(
            ModelSelection mainModel,
            ModelSelection qqBotModel,
            ModelSelection compressionModel
    ) {}

    /** 模型选择 */
    public record ModelSelection(
            String providerId,
            String modelId,
            String modelName,
            boolean sameAsMain
    ) {}

    /**
     * 获取用于 Minecraft 假人名称的显示名。
     * 优先使用 alias，其次 name。
     * 自动截断到 16 字符并过滤非法字符。
     */
    public String botName() {
        String raw = (alias != null && !alias.isBlank()) ? alias : name;
        // 只保留字母数字和下划线
        String sanitized = raw.replaceAll("[^a-zA-Z0-9_]", "_");
        // 截断到 16 字符
        return sanitized.length() > 16 ? sanitized.substring(0, 16) : sanitized;
    }
}