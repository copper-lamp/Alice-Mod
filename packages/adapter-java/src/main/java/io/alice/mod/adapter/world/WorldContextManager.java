package io.alice.mod.adapter.world;

import net.minecraft.server.MinecraftServer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * 世界上下文管理器 — 全局单例。
 * <p>
 * 管理当前活跃世界上下文，处理世界切换时的生命周期。
 * 每个 Minecraft 世界（存档/服务器）对应一个 {@link WorldContext} 实例。
 * <p>
 * <strong>仅主机模式：</strong>只有本地有 MinecraftServer 实例时才会激活上下文。
 * 作为客户端连接远程服务器时，{@code SERVER_STARTED} 事件不会触发，
 * 因此 {@code activate()} 不会被调用——客场自动停用，无需额外配置。
 */
public final class WorldContextManager {

    private static final Logger LOG = LoggerFactory.getLogger(WorldContextManager.class);
    private static final WorldContextManager INSTANCE = new WorldContextManager();

    /** 当前活跃的世界上下文。 */
    private volatile WorldContext activeContext;

    private WorldContextManager() {}

    /** 获取单例实例。 */
    public static WorldContextManager getInstance() {
        return INSTANCE;
    }

    /** 获取当前活跃上下文。可能为 null（主菜单或客场）。 */
    public static WorldContext getActive() {
        return INSTANCE.activeContext;
    }

    /** 是否有活跃上下文。 */
    public static boolean isActive() {
        return INSTANCE.activeContext != null;
    }

    /**
     * 创建并激活一个新世界上下文。
     * <p>
     * 在 {@code ServerLifecycleEvents.SERVER_STARTED} 中调用。
     * 如果已有活跃上下文，会先关闭旧的。
     *
     * @param server 刚启动的 MinecraftServer 实例
     * @return 新激活的世界上下文
     */
    public static WorldContext activate(MinecraftServer server) {
        // 1. 关闭前一个上下文（如果有）
        deactivate();

        // 2. 构建世界身份
        WorldIdentity identity = WorldIdentity.forServer(server);

        // 3. 创建并初始化新上下文
        WorldContext ctx = new WorldContext(server, identity);
        try {
            ctx.initialize();
            INSTANCE.activeContext = ctx;
            LOG.info("WorldContext activated: world='{}', instance={}",
                    identity.worldName(), identity.instanceId());
        } catch (Exception e) {
            LOG.error("Failed to activate WorldContext for world '{}'",
                    identity.worldName(), e);
            ctx.shutdown();
        }

        return INSTANCE.activeContext;
    }

    /**
     * 停用当前世界上下文。
     * <p>
     * 在 {@code ServerLifecycleEvents.SERVER_STOPPING} 中调用。
     */
    public static void deactivate() {
        WorldContext ctx = INSTANCE.activeContext;
        if (ctx != null) {
            ctx.shutdown();
            INSTANCE.activeContext = null;
            LOG.info("WorldContext deactivated");
        }
    }
}
