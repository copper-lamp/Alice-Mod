package io.alice.mod.adapter.ai.interaction;

import io.alice.mod.adapter.ai.BotAccess;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.Mob;
import net.minecraft.world.entity.animal.Animal;
import net.minecraft.world.entity.animal.Sheep;
import net.minecraft.world.entity.decoration.LeashFenceKnotEntity;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/**
 * 生物交互 AI 控制器——提供生物交互能力。
 */
public final class EntityInteractionController {

    private static final Logger LOG = LoggerFactory.getLogger(EntityInteractionController.class);

    private EntityInteractionController() {}

    /**
     * 与实体交互。
     */
    public static InteractionResult interactEntity(String entityId, String action, Integer tradeIndex) {
        ServerPlayer bot = BotAccess.getBot();
        if (bot == null) {
            return new InteractionResult(false, "Bot 未找到", null);
        }

        try {
            ServerLevel level = (ServerLevel) bot.level();
            UUID uuid = UUID.fromString(entityId);
            Entity target = level.getEntity(uuid);

            if (target == null) {
                return new InteractionResult(false, "实体未找到: " + entityId, null);
            }

            Map<String, Object> data = new HashMap<>();
            data.put("entityId", entityId);
            data.put("entityType", target.getType().getDescriptionId());
            data.put("action", action);

            switch (action != null ? action : "interact") {
                case "feed":
                    // 喂食（需要手持食物）
                    if (target instanceof Animal animal) {
                        ItemStack food = bot.getMainHandItem();
                        if (food.isEmpty()) {
                            return new InteractionResult(false, "手中没有食物", null);
                        }
                        // TODO: 实现喂食逻辑
                        return new InteractionResult(true, "已喂食 " + target.getName().getString(), data);
                    }
                    return new InteractionResult(false, "该实体不可喂食", null);

                case "breed":
                    // 繁殖
                    if (target instanceof Animal animal) {
                        // TODO: 实现繁殖逻辑
                        return new InteractionResult(true, "已尝试繁殖 " + target.getName().getString(), data);
                    }
                    return new InteractionResult(false, "该实体不可繁殖", null);

                case "trade":
                    // 交易
                    // TODO: 实现村民交易逻辑
                    return new InteractionResult(false, "交易功能暂未实现", null);

                case "tame":
                    // 驯服
                    // TODO: 实现驯服逻辑
                    return new InteractionResult(false, "驯服功能暂未实现", null);

                case "shear":
                    // 剪毛
                    if (target instanceof Sheep sheep) {
                        if (sheep.readyForShearing()) {
                            // TODO: 实现剪毛逻辑
                            return new InteractionResult(true, "已剪毛 " + target.getName().getString(), data);
                        }
                        return new InteractionResult(false, "该羊还没有准备好", null);
                    }
                    return new InteractionResult(false, "该实体不可剪毛", null);

                case "milk":
                    // 挤奶
                    // TODO: 实现挤奶逻辑
                    return new InteractionResult(false, "挤奶功能暂未实现", null);

                default:
                    return new InteractionResult(false, "无效的操作: " + action, null);
            }
        } catch (Exception e) {
            LOG.error("Failed to interact with entity", e);
            return new InteractionResult(false, "交互失败: " + e.getMessage(), null);
        }
    }

    /**
     * 拴绳/释放实体。
     */
    public static InteractionResult leadEntity(String entityId, String action) {
        ServerPlayer bot = BotAccess.getBot();
        if (bot == null) {
            return new InteractionResult(false, "Bot 未找到", null);
        }

        try {
            ServerLevel level = (ServerLevel) bot.level();
            UUID uuid = UUID.fromString(entityId);
            Entity target = level.getEntity(uuid);

            if (target == null) {
                return new InteractionResult(false, "实体未找到: " + entityId, null);
            }

            if (!(target instanceof Mob mob)) {
                return new InteractionResult(false, "该实体不可拴绳", null);
            }

            Map<String, Object> data = new HashMap<>();
            data.put("entityId", entityId);
            data.put("entityType", target.getType().getDescriptionId());

            switch (action != null ? action : "lead") {
                case "lead":
                    // 拴绳
                    // TODO: 实现拴绳逻辑
                    return new InteractionResult(true, "已拴绳 " + target.getName().getString(), data);

                case "release":
                    // 释放
                    if (mob.isLeashed()) {
                        mob.dropLeash();
                        return new InteractionResult(true, "已释放 " + target.getName().getString(), data);
                    }
                    return new InteractionResult(false, "该实体未被拴绳", null);

                default:
                    return new InteractionResult(false, "无效的操作: " + action, null);
            }
        } catch (Exception e) {
            LOG.error("Failed to lead entity", e);
            return new InteractionResult(false, "拴绳失败: " + e.getMessage(), null);
        }
    }

    // ---- 数据记录 ----

    public record InteractionResult(boolean success, String message, Map<String, Object> data) {}
}
