package io.alice.mod.adapter.tool.entity;

import io.alice.mod.adapter.ai.combat.CombatController;
import io.alice.mod.adapter.ai.interaction.EntityInteractionController;
import io.alice.mod.adapter.tool.ToolResult;
import io.alice.mod.adapter.tool.annotation.ToolMethod;
import io.alice.mod.adapter.tool.annotation.ToolModule;
import io.alice.mod.adapter.tool.annotation.ToolParam;

import java.util.Map;

/**
 * 生物交互工具模块——提供生物交互能力。
 */
@ToolModule(category = "entity", description = "生物类工具")
public enum EntityInteractionTools {
    INSTANCE;

    @ToolMethod(
            name = "set_combat_mode",
            description = "设置战斗模式",
            parameters = {
                    @ToolParam(name = "mode", type = "string", 
                            description = "战斗模式: melee/ranged/defensive"),
                    @ToolParam(name = "targetId", type = "string", 
                            description = "目标实体 ID", required = false)
            }
    )
    public ToolResult setCombatMode(Map<String, Object> params) {
        long start = System.currentTimeMillis();
        try {
            String mode = (String) params.get("mode");
            String targetId = (String) params.get("targetId");

            var result = CombatController.setCombatMode(mode, targetId);
            if (result.success()) {
                return ToolResult.ok(result.message(), result.data(), start);
            } else {
                return ToolResult.fail("COMBAT_MODE_FAILED", result.message(), start);
            }
        } catch (Exception e) {
            return ToolResult.fail("INTERNAL_ERROR", e.getMessage(), start);
        }
    }

    @ToolMethod(
            name = "stop_combat",
            description = "停止战斗",
            parameters = {}
    )
    public ToolResult stopCombat(Map<String, Object> params) {
        long start = System.currentTimeMillis();
        try {
            var result = CombatController.stopCombat();
            if (result.success()) {
                return ToolResult.ok(result.message(), result.data(), start);
            } else {
                return ToolResult.fail("STOP_COMBAT_FAILED", result.message(), start);
            }
        } catch (Exception e) {
            return ToolResult.fail("INTERNAL_ERROR", e.getMessage(), start);
        }
    }

    @ToolMethod(
            name = "interact_entity",
            description = "与实体交互（喂食/繁殖/交易/驯服/剪毛/挤奶）",
            parameters = {
                    @ToolParam(name = "entityId", type = "string", description = "实体 UUID"),
                    @ToolParam(name = "action", type = "string", 
                            description = "交互动作: feed/breed/trade/tame/shear/milk"),
                    @ToolParam(name = "tradeIndex", type = "number", 
                            description = "交易选项索引（trade 动作）", required = false)
            }
    )
    public ToolResult interactEntity(Map<String, Object> params) {
        long start = System.currentTimeMillis();
        try {
            String entityId = (String) params.get("entityId");
            String action = (String) params.get("action");
            Integer tradeIndex = params.containsKey("tradeIndex") 
                    ? ((Number) params.get("tradeIndex")).intValue() 
                    : null;

            var result = EntityInteractionController.interactEntity(entityId, action, tradeIndex);
            if (result.success()) {
                return ToolResult.ok(result.message(), result.data(), start);
            } else {
                return ToolResult.fail("INTERACT_FAILED", result.message(), start);
            }
        } catch (Exception e) {
            return ToolResult.fail("INTERNAL_ERROR", e.getMessage(), start);
        }
    }

    @ToolMethod(
            name = "lead_entity",
            description = "拴绳/释放实体",
            parameters = {
                    @ToolParam(name = "entityId", type = "string", description = "实体 UUID"),
                    @ToolParam(name = "action", type = "string", 
                            description = "操作: lead/release")
            }
    )
    public ToolResult leadEntity(Map<String, Object> params) {
        long start = System.currentTimeMillis();
        try {
            String entityId = (String) params.get("entityId");
            String action = (String) params.get("action");

            var result = EntityInteractionController.leadEntity(entityId, action);
            if (result.success()) {
                return ToolResult.ok(result.message(), result.data(), start);
            } else {
                return ToolResult.fail("LEAD_FAILED", result.message(), start);
            }
        } catch (Exception e) {
            return ToolResult.fail("INTERNAL_ERROR", e.getMessage(), start);
        }
    }
}
