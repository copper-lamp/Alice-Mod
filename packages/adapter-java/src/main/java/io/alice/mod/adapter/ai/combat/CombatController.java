package io.alice.mod.adapter.ai.combat;

import io.alice.mod.adapter.ai.BotAccess;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.Mob;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/**
 * 战斗 AI 控制器——提供战斗模式控制能力。
 */
public final class CombatController {

    private static final Logger LOG = LoggerFactory.getLogger(CombatController.class);

    private CombatController() {}

    /**
     * 设置战斗模式。
     */
    public static CombatResult setCombatMode(String mode, String targetId) {
        ServerPlayer bot = BotAccess.getBot();
        if (bot == null) {
            return new CombatResult(false, "Bot 未找到", null);
        }

        try {
            // targetId 可选 - 不传时只设置战斗模式
            Map<String, Object> data = new HashMap<>();
            data.put("mode", mode);

            if (targetId != null && !targetId.isEmpty()) {
                ServerLevel level = (ServerLevel) bot.level();
                UUID uuid = UUID.fromString(targetId);
                Entity target = level.getEntity(uuid);

                if (target == null) {
                    return new CombatResult(false, "目标实体未找到: " + targetId, null);
                }

                if (!(target instanceof LivingEntity)) {
                    return new CombatResult(false, "目标不是生物实体", null);
                }

                data.put("targetId", targetId);
                data.put("targetType", target.getType().getDescriptionId());
            }

            // 验证战斗模式
            if (mode != null && !mode.isEmpty() 
                    && !mode.equals("melee") && !mode.equals("ranged") && !mode.equals("defensive")) {
                return new CombatResult(false, "不支持的战斗模式: " + mode, null);
            }

            // TODO: 实现战斗模式状态机（melee/ranged/defensive）
            // 当前返回占位结果
            return new CombatResult(true, 
                    String.format("已设置战斗模式: %s", mode != null ? mode : "none"), 
                    data);
        } catch (Exception e) {
            LOG.error("Failed to set combat mode", e);
            return new CombatResult(false, "设置战斗模式失败: " + e.getMessage(), null);
        }
    }

    /**
     * 停止战斗。
     */
    public static CombatResult stopCombat() {
        ServerPlayer bot = BotAccess.getBot();
        if (bot == null) {
            return new CombatResult(false, "Bot 未找到", null);
        }

        try {
            // TODO: 实现战斗状态重置
            return new CombatResult(true, "已停止战斗", null);
        } catch (Exception e) {
            LOG.error("Failed to stop combat", e);
            return new CombatResult(false, "停止战斗失败: " + e.getMessage(), null);
        }
    }

    // ---- 数据记录 ----

    public record CombatResult(boolean success, String message, Map<String, Object> data) {}
}
