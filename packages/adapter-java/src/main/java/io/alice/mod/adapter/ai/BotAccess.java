package io.alice.mod.adapter.ai;

import carpet.patches.EntityPlayerMPFake;
import io.alice.mod.adapter.ai.behavior.TaskRunner;
import io.alice.mod.adapter.api.service.BotHandle;
import io.alice.mod.adapter.api.service.PathfindingService;
import io.alice.mod.adapter.api.types.Vec3;
import io.alice.mod.adapter.world.WorldContext;
import io.alice.mod.adapter.world.WorldContextManager;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerLifecycleEvents;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.level.Level;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.Set;
import java.util.UUID;

/**
 * Bot 访问层——提供对当前假人实例的访问。
 * <p>
 * V10 实现：通过 BotManager 获取假人实例。
 */
public final class BotAccess {

    private static final Logger LOG = LoggerFactory.getLogger(BotAccess.class);
    private static MinecraftServer server;
    private static PathfindingService pathfindingService;
    private static TaskRunner taskRunner;

    private BotAccess() {}

    /**
     * 初始化 BotAccess，注册服务器启动事件。
     * 应在模组初始化时调用。
     */
    public static void init() {
        ServerLifecycleEvents.SERVER_STARTED.register(s -> {
            server = s;
            LOG.info("BotAccess: MinecraftServer initialized");
        });

        ServerLifecycleEvents.SERVER_STOPPED.register(s -> {
            server = null;
            LOG.info("BotAccess: MinecraftServer cleared");
        });
    }

    /**
     * 获取当前 MinecraftServer 实例。
     * <p>
     * 优先返回 {@link #init()} 中 SERVER_STARTED 事件设置的引用，
     * 兜底从活跃的 WorldContext 获取。
     *
     * @return MinecraftServer 实例，或 null（如果服务器未启动）
     */
    public static MinecraftServer getServer() {
        if (server != null) return server;
        // 兜底：从活跃的 WorldContext 获取
        WorldContext ctx = WorldContextManager.getActive();
        if (ctx != null) return ctx.getServer();
        return null;
    }

    /**
     * 获取第一个可用的假人。
     * <p>
     * 如果存在多个假人，返回第一个。推荐使用 {@link #getBotByName} 精确指定。
     *
     * @return 假人实例，或 null（如果没有在线假人）
     */
    public static ServerPlayer getBot() {
        io.alice.mod.adapter.bot.BotManager mgr = WorldContextManager.isActive()
                ? WorldContextManager.getActive().getBotManager() : null;
        if (mgr == null) {
            LOG.warn("BotAccess: no active BotManager");
            return null;
        }
        java.util.List<EntityPlayerMPFake> bots = mgr.findAll();
        if (bots.isEmpty()) {
            LOG.warn("BotAccess: no online bots available");
            return null;
        }
        return bots.get(0);
    }

    /**
     * 获取指定名称的假人。
     *
     * @param botName 假人名称
     * @return 假人实例，或 null
     */
    public static ServerPlayer getBotByName(String botName) {
        io.alice.mod.adapter.bot.BotManager mgr = WorldContextManager.isActive()
                ? WorldContextManager.getActive().getBotManager() : null;
        return mgr != null ? mgr.findByName(botName) : null;
    }

    /**
     * 获取指定名称的玩家（包括真实玩家和假人）。
     *
     * @param playerName 玩家名称
     * @return ServerPlayer 实例，或 null
     */
    public static ServerPlayer getPlayer(String playerName) {
        if (server == null) return null;
        return server.getPlayerList().getPlayerByName(playerName);
    }

    /**
     * 获取所有在线玩家。
     *
     * @return 在线玩家列表
     */
    public static java.util.List<ServerPlayer> getOnlinePlayers() {
        if (server == null) return java.util.List.of();
        return server.getPlayerList().getPlayers();
    }

    // ──────────────────────────────────────────────
    //  寻路服务
    // ──────────────────────────────────────────────

    /**
     * 设置寻路服务实例。
     * 在 WorldContext 初始化时调用。
     */
    public static void setPathfindingService(PathfindingService service) {
        pathfindingService = service;
        LOG.debug("BotAccess: PathfindingService set to {}", service);
    }

    /**
     * 获取寻路服务实例。
     *
     * @return 寻路服务实例，或 null（如果未设置）
     */
    public static PathfindingService getPathfindingService() {
        return pathfindingService;
    }

    // ──────────────────────────────────────────────
    //  任务运行器
    // ──────────────────────────────────────────────

    /**
     * 设置任务运行器实例。
     * 在 WorldContext 初始化时调用。
     */
    public static void setTaskRunner(TaskRunner runner) {
        taskRunner = runner;
        LOG.debug("BotAccess: TaskRunner set to {}", runner);
    }

    /**
     * 获取任务运行器实例。
     *
     * @return 任务运行器，或 null（如果未初始化）
     */
    public static TaskRunner getTaskRunner() {
        return taskRunner;
    }

    /**
     * 获取 UserTaskChain（用于执行用户任务）。
     * 通过 TaskRunner 查找。
     *
     * @return UserTaskChain，或 null（如果未初始化）
     */
    public static io.alice.mod.adapter.ai.behavior.chain.UserTaskChain getUserTaskChain() {
        if (taskRunner == null) return null;
        // 从 TaskRunner 的 chains 中查找 UserTaskChain
        for (io.alice.mod.adapter.ai.behavior.TaskChain chain : taskRunner.getChains()) {
            if (chain instanceof io.alice.mod.adapter.ai.behavior.chain.UserTaskChain utc) {
                return utc;
            }
        }
        return null;
    }

    // ──────────────────────────────────────────────
    //  BotHandle 工厂
    // ──────────────────────────────────────────────

    /**
     * 从 ServerPlayer 创建 BotHandle 实例。
     * <p>
     * 用于工具层向行为树提交任务时需要 BotHandle 的场景。
     *
     * @param player Minecraft ServerPlayer 实例
     * @return BotHandle 实例，或 null（如果 player 为 null）
     */
    public static BotHandle createBotHandle(ServerPlayer player) {
        if (player == null) return null;
        return new BotHandle() {
            @Override
            public UUID uuid() { return player.getUUID(); }

            @Override
            public String name() { return player.getName().getString(); }

            @Override
            public Vec3 position() {
                net.minecraft.world.phys.Vec3 pos = player.position();
                return Vec3.of(pos.x(), pos.y(), pos.z());
            }

            @Override
            public String dimension() {
                return ((ServerLevel) player.level()).dimension().location().toString();
            }

            @Override
            public float health() { return player.getHealth(); }

            @Override
            public float maxHealth() { return player.getMaxHealth(); }

            @Override
            public int foodLevel() { return player.getFoodData().getFoodLevel(); }

            @Override
            public int experienceLevel() { return player.experienceLevel; }

            @Override
            public void teleport(double x, double y, double z, String dimension) {
                MinecraftServer srv = server;
                if (srv == null) srv = getServer();
                if (srv == null) return;
                ServerLevel targetLevel = switch (dimension.toLowerCase()) {
                    case "overworld", "minecraft:overworld" -> srv.overworld();
                    case "nether", "minecraft:the_nether" -> srv.getLevel(Level.NETHER);
                    case "end", "minecraft:the_end" -> srv.getLevel(Level.END);
                    default -> {
                        var dimId = net.minecraft.resources.ResourceLocation.tryParse(dimension);
                        if (dimId != null) {
                            yield srv.getLevel(
                                    net.minecraft.resources.ResourceKey.create(
                                            net.minecraft.core.registries.Registries.DIMENSION, dimId));
                        }
                        yield null;
                    }
                };
                if (targetLevel != null) {
                    player.teleportTo(targetLevel, x, y, z, Set.of(), player.getYRot(), player.getXRot(), false);
                }
            }

            @Override
            @SuppressWarnings("unchecked")
            public <T> T getNativePlayer() { return (T) player; }
        };
    }
}
