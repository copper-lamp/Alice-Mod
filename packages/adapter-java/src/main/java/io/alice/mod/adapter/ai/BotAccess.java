package io.alice.mod.adapter.ai;

import carpet.patches.EntityPlayerMPFake;
import io.alice.mod.adapter.world.WorldContext;
import io.alice.mod.adapter.world.WorldContextManager;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerLifecycleEvents;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Bot 访问层——提供对当前假人实例的访问。
 * <p>
 * V10 实现：通过 BotManager 获取假人实例。
 */
public final class BotAccess {

    private static final Logger LOG = LoggerFactory.getLogger(BotAccess.class);
    private static MinecraftServer server;

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
}
