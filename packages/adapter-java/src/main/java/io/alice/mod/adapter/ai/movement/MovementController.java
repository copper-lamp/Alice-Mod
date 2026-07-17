package io.alice.mod.adapter.ai.movement;

import io.alice.mod.adapter.ai.BotAccess;
import net.minecraft.core.BlockPos;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.phys.Vec3;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/**
 * 移动 AI 控制器——提供移动、跟随、骑乘等能力。
 */
public final class MovementController {

    private static final Logger LOG = LoggerFactory.getLogger(MovementController.class);

    private MovementController() {}

    /**
     * 移动到指定坐标。
     */
    public static MovementResult moveTo(double x, Double y, double z, boolean allowBreak) {
        ServerPlayer bot = BotAccess.getBot();
        if (bot == null) {
            return new MovementResult(false, "Bot 未找到", null);
        }

        try {
            ServerLevel level = (ServerLevel) bot.level();
            BlockPos targetPos = new BlockPos((int) x, y != null ? y.intValue() : (int) bot.getY(), (int) z);

            // 检查目标位置是否安全
            if (!isSafeLocation(level, targetPos)) {
                String belowBlock = level.getBlockState(targetPos.below()).getBlock().getName().getString();
                String targetBlock = level.getBlockState(targetPos).getBlock().getName().getString();
                LOG.warn("move_to: 目标位置不安全 pos=({},{},{}) target={} below={}",
                        targetPos.getX(), targetPos.getY(), targetPos.getZ(), targetBlock, belowBlock);
                return new MovementResult(false, 
                        "目标位置不安全: 下方方块=" + belowBlock, null);
            }

            // 简单传送实现（后续版本实现寻路）
            Vec3 targetVec = new Vec3(x + 0.5, y != null ? y : bot.getY(), z + 0.5);
            bot.teleportTo(targetVec.x, targetVec.y, targetVec.z);

            Map<String, Object> data = new HashMap<>();
            data.put("x", x);
            data.put("y", y != null ? y : bot.getY());
            data.put("z", z);

            return new MovementResult(true, 
                    String.format("已移动到 (%.1f, %.1f, %.1f)", x, y != null ? y : bot.getY(), z), 
                    data);
        } catch (Exception e) {
            LOG.error("Failed to move to position", e);
            return new MovementResult(false, "移动失败: " + e.getMessage(), null);
        }
    }

    /**
     * 跟随指定实体。
     */
    public static MovementResult followEntity(String entityId, int distance, boolean allowBreak) {
        ServerPlayer bot = BotAccess.getBot();
        if (bot == null) {
            return new MovementResult(false, "Bot 未找到", null);
        }

        try {
            ServerLevel level = (ServerLevel) bot.level();
            UUID uuid = UUID.fromString(entityId);
            Entity target = level.getEntity(uuid);

            if (target == null) {
                return new MovementResult(false, "实体未找到: " + entityId, null);
            }

            // 简单实现：传送到实体附近
            Vec3 targetPos = target.position();
            double offsetX = (Math.random() - 0.5) * distance * 2;
            double offsetZ = (Math.random() - 0.5) * distance * 2;
            bot.teleportTo(targetPos.x + offsetX, targetPos.y, targetPos.z + offsetZ);

            Map<String, Object> data = new HashMap<>();
            data.put("entityId", entityId);
            data.put("entityType", target.getType().getDescriptionId());
            data.put("distance", bot.distanceTo(target));

            return new MovementResult(true, 
                    String.format("已跟随 %s (%.1f格)", target.getName().getString(), bot.distanceTo(target)), 
                    data);
        } catch (Exception e) {
            LOG.error("Failed to follow entity", e);
            return new MovementResult(false, "跟随失败: " + e.getMessage(), null);
        }
    }

    /**
     * 移动到指定高度。
     */
    public static MovementResult moveToHeight(double y, boolean allowBreak) {
        ServerPlayer bot = BotAccess.getBot();
        if (bot == null) {
            return new MovementResult(false, "Bot 未找到", null);
        }

        try {
            // 保持当前 XZ，只改变 Y
            Vec3 currentPos = bot.position();
            bot.teleportTo(currentPos.x, y, currentPos.z);

            Map<String, Object> data = new HashMap<>();
            data.put("y", y);

            return new MovementResult(true, 
                    String.format("已移动到高度 %.1f", y), 
                    data);
        } catch (Exception e) {
            LOG.error("Failed to move to height", e);
            return new MovementResult(false, "移动失败: " + e.getMessage(), null);
        }
    }

    /**
     * 骑乘实体。
     */
    public static MovementResult ride(String entityId) {
        ServerPlayer bot = BotAccess.getBot();
        if (bot == null) {
            return new MovementResult(false, "Bot 未找到", null);
        }

        try {
            ServerLevel level = (ServerLevel) bot.level();
            UUID uuid = UUID.fromString(entityId);
            Entity target = level.getEntity(uuid);

            if (target == null) {
                return new MovementResult(false, "实体未找到: " + entityId, null);
            }

            if (bot.isPassenger()) {
                return new MovementResult(false, "已经在骑乘中", null);
            }

            boolean success = bot.startRiding(target);
            if (success) {
                Map<String, Object> data = new HashMap<>();
                data.put("entityId", entityId);
                data.put("entityType", target.getType().getDescriptionId());

                return new MovementResult(true, 
                        "已骑乘 " + target.getName().getString(), 
                        data);
            } else {
                return new MovementResult(false, "无法骑乘该实体", null);
            }
        } catch (Exception e) {
            LOG.error("Failed to ride entity", e);
            return new MovementResult(false, "骑乘失败: " + e.getMessage(), null);
        }
    }

    /**
     * 脱离骑乘。
     */
    public static MovementResult dismount() {
        ServerPlayer bot = BotAccess.getBot();
        if (bot == null) {
            return new MovementResult(false, "Bot 未找到", null);
        }

        try {
            if (!bot.isPassenger()) {
                return new MovementResult(false, "当前未骑乘任何实体", null);
            }

            Entity vehicle = bot.getVehicle();
            bot.stopRiding();

            Map<String, Object> data = new HashMap<>();
            if (vehicle != null) {
                data.put("entityType", vehicle.getType().getDescriptionId());
            }

            return new MovementResult(true, "已脱离骑乘", data);
        } catch (Exception e) {
            LOG.error("Failed to dismount", e);
            return new MovementResult(false, "脱离失败: " + e.getMessage(), null);
        }
    }

    /**
     * 检查位置是否安全。
     */
    private static boolean isSafeLocation(ServerLevel level, BlockPos pos) {
        // 检查是否为空气或可替换方块
        if (!level.getBlockState(pos).isAir() && !level.getBlockState(pos).canBeReplaced()) {
            return false;
        }

        // 检查下方是否有固体方块（防止掉入虚空）
        BlockPos below = pos.below();
        if (!level.getBlockState(below).isSolid()) {
            return false;
        }

        return true;
    }

    // ---- 数据记录 ----

    public record MovementResult(boolean success, String message, Map<String, Object> data) {}
}
