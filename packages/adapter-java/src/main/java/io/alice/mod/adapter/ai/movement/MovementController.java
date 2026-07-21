package io.alice.mod.adapter.ai.movement;

import io.alice.mod.adapter.ai.BotAccess;
import io.alice.mod.adapter.ai.behavior.chain.UserTaskChain;
import io.alice.mod.adapter.ai.behavior.task.FollowEntityTask;
import io.alice.mod.adapter.ai.behavior.task.MoveToTask;
import io.alice.mod.adapter.api.service.BotHandle;
import io.alice.mod.adapter.api.types.Vec3;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.Entity;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/**
 * 移动 AI 控制器——提供移动、跟随、骑乘等能力。
 * <p>
 * 使用 {@link MoveToTask} + {@link UserTaskChain} 实现真实移动，
 * 替代原先的 tp 传送假实现。
 * <p>
 * 注意：工具调用是同步的，但移动是异步的（由行为树每 tick 驱动）。
 * 因此 moveTo/followEntity 等方法会立即返回"任务已提交"状态，
 * 实际移动通过行为树在后续 tick 中执行。
 */
public final class MovementController {

    private static final Logger LOG = LoggerFactory.getLogger(MovementController.class);

    private MovementController() {}

    // ──────────────────────────────────────────────
    //  移动
    // ──────────────────────────────────────────────

    /**
     * 移动到指定坐标。
     * <p>
     * 使用 {@link MoveToTask} 通过行为树执行真实移动（非 tp）。
     *
     * @param x          目标 X 坐标
     * @param y          目标 Y 坐标（null 表示保持当前高度）
     * @param z          目标 Z 坐标
     * @param allowBreak 是否允许破坏方块（暂未使用，保留给未来寻路升级）
     * @return 移动结果
     */
    public static MovementResult moveTo(double x, Double y, double z, boolean allowBreak) {
        ServerPlayer bot = BotAccess.getBot();
        if (bot == null) {
            return new MovementResult(false, "Bot 未找到", null);
        }

        try {
            BotHandle handle = BotAccess.createBotHandle(bot);
            UserTaskChain chain = BotAccess.getUserTaskChain();
            if (chain == null) {
                return new MovementResult(false, "任务系统未初始化", null);
            }

            double targetY = y != null ? y : bot.getY();
            Vec3 target = Vec3.of(x + 0.5, targetY, z + 0.5);
            MoveToTask task = new MoveToTask(target);

            chain.runTask(handle, task, () ->
                    LOG.debug("MoveToTask completed for {}", target));

            Map<String, Object> data = new HashMap<>();
            data.put("x", x);
            data.put("y", targetY);
            data.put("z", z);
            data.put("task_type", "MoveToTask");

            return new MovementResult(true,
                    String.format("正在移动到 (%.1f, %.1f, %.1f)", x, targetY, z),
                    data);
        } catch (Exception e) {
            LOG.error("Failed to start movement", e);
            return new MovementResult(false, "移动启动失败: " + e.getMessage(), null);
        }
    }

    /**
     * 跟随指定实体。
     * <p>
     * 使用 {@link FollowEntityTask} 持续追踪目标实体。
     *
     * @param entityId   实体 UUID
     * @param distance   跟随距离（方块）
     * @param allowBreak 是否允许破坏方块（暂未使用）
     * @return 跟随结果
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

            BotHandle handle = BotAccess.createBotHandle(bot);
            UserTaskChain chain = BotAccess.getUserTaskChain();
            if (chain == null) {
                return new MovementResult(false, "任务系统未初始化", null);
            }

            FollowEntityTask task = new FollowEntityTask(target, distance);

            chain.runTask(handle, task, () ->
                    LOG.debug("FollowEntityTask completed for {}", entityId));

            Map<String, Object> data = new HashMap<>();
            data.put("entityId", entityId);
            data.put("entityType", target.getType().getDescriptionId());
            data.put("task_type", "FollowEntityTask");

            return new MovementResult(true,
                    "正在跟随 " + target.getName().getString(),
                    data);
        } catch (Exception e) {
            LOG.error("Failed to follow entity", e);
            return new MovementResult(false, "跟随失败: " + e.getMessage(), null);
        }
    }

    /**
     * 移动到指定高度。
     * <p>
     * 保持当前 XZ 坐标，只改变 Y 坐标。
     *
     * @param y          目标高度
     * @param allowBreak 是否允许破坏方块（暂未使用）
     * @return 移动结果
     */
    public static MovementResult moveToHeight(double y, boolean allowBreak) {
        ServerPlayer bot = BotAccess.getBot();
        if (bot == null) {
            return new MovementResult(false, "Bot 未找到", null);
        }

        try {
            BotHandle handle = BotAccess.createBotHandle(bot);
            UserTaskChain chain = BotAccess.getUserTaskChain();
            if (chain == null) {
                return new MovementResult(false, "任务系统未初始化", null);
            }

            Vec3 currentPos = handle.position();
            Vec3 target = Vec3.of(currentPos.x(), y, currentPos.z());
            MoveToTask task = new MoveToTask(target);

            chain.runTask(handle, task, () ->
                    LOG.debug("MoveToTask completed for height {}", y));

            Map<String, Object> data = new HashMap<>();
            data.put("y", y);
            data.put("task_type", "MoveToTask");

            return new MovementResult(true,
                    String.format("正在移动到高度 %.1f", y),
                    data);
        } catch (Exception e) {
            LOG.error("Failed to move to height", e);
            return new MovementResult(false, "移动启动失败: " + e.getMessage(), null);
        }
    }

    // ──────────────────────────────────────────────
    //  骑乘
    // ──────────────────────────────────────────────

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

    // ---- 数据记录 ----

    public record MovementResult(boolean success, String message, Map<String, Object> data) {}
}