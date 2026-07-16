package io.alice.mod.adapter;

import io.alice.mod.adapter.ai.BotAccess;
import io.alice.mod.adapter.world.WorldContextManager;
import net.fabricmc.api.DedicatedServerModInitializer;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerLifecycleEvents;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Alice Mod 服务端入口。
 * <p>
 * 注册 ServerLifecycleEvents，在世界加载时激活 {@link WorldContextManager}。
 * 专用服务器（Dedicated Server）和集成服务器（Integrated Server）都会触发此入口。
 * <p>
 * <strong>仅主机模式：</strong>客场（连接远程服务器的客户端）不会触发
 * {@code SERVER_STARTED}，因此 {@link WorldContextManager#activate} 不会被调用，
 * 整个 Alice Mod 在客户端侧保持休眠——无需额外配置。
 */
public class AliceModServer implements DedicatedServerModInitializer {

    private static final Logger LOG = LoggerFactory.getLogger("alice-mod-server");

    @Override
    public void onInitializeServer() {
        LOG.info("Alice Mod Server initializing...");

        // 初始化 BotAccess（注册 SERVER_STARTED/STOPPED 事件监听）
        BotAccess.init();

        // 注册服务端启动事件 → 激活世界上下文
        ServerLifecycleEvents.SERVER_STARTED.register(server -> {
            // integrated server 也会触发此事件
            WorldContextManager.activate(server);
        });

        // 注册服务端停止事件 → 停用世界上下文
        ServerLifecycleEvents.SERVER_STOPPING.register(server -> {
            WorldContextManager.deactivate();
        });

        // 注册服务端停止后事件 → 确保清理
        ServerLifecycleEvents.SERVER_STOPPED.register(server -> {
            WorldContextManager.deactivate();
        });

        LOG.info("Alice Mod Server initialized.");
    }
}
