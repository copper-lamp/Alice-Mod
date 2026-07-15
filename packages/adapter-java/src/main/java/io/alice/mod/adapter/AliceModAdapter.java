package io.alice.mod.adapter;

import io.alice.mod.adapter.config.AliceCommand;
import io.alice.mod.adapter.config.PathMigration;
import io.alice.mod.adapter.tool.ServiceAccessImpl;
import io.alice.mod.adapter.tool.ToolPluginDiscoverer;
import io.alice.mod.adapter.tool.ToolRegistrarImpl;
import io.alice.mod.adapter.tool.ToolRegistry;
import io.alice.mod.adapter.tool.ToolScanner;
import net.fabricmc.api.ModInitializer;
import net.fabricmc.loader.api.FabricLoader;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.nio.file.Path;

/**
 * Alice Mod JE 模组主入口（通用初始化）。
 * <p>
 * 职责范围（一次性初始化）：
 * <ul>
 *   <li>工具扫描与注册</li>
 *   <li>附属模组插件发现</li>
 *   <li>Fabric API 事件注册</li>
 * </ul>
 * <p>
 * <strong>此入口不启动 TCP 客户端或假人管理器。</strong>
 * 世界相关的初始化由 {@link AliceModServer} 在 {@code SERVER_STARTED} 时触发。
 */
public class AliceModAdapter implements ModInitializer {

    public static final Logger LOGGER = LoggerFactory.getLogger("alice-mod");

    @Override
    public void onInitialize() {
        LOGGER.info("Alice Mod Adapter JE initializing...");

        // 0. 执行路径迁移（config/mcagent/ → Alice/）
        Path gameDir = FabricLoader.getInstance().getGameDir();
        boolean migrated = PathMigration.migrateIfNeeded(gameDir);
        if (migrated) {
            LOGGER.info("Path migration completed: config/mcagent/ -> Alice/");
        }

        // 1. 注册 Fabric 指令
        AliceCommand.register();
        LOGGER.info("Alice commands registered");

        // 2. 扫描并注册内建工具
        ToolScanner.scanAndRegister("io.alice.mod.adapter.tool");
        int builtinCount = ToolRegistry.size();
        LOGGER.info("Built-in tools registered: {}", builtinCount);

        // 3. 发现并注册附属模组插件工具
        ServiceAccessImpl serviceAccess = new ServiceAccessImpl();
        ToolPluginDiscoverer.discover().forEach(plugin -> {
            ToolRegistrarImpl registrar = new ToolRegistrarImpl();
            try {
                plugin.registerTools(registrar, serviceAccess);
                registrar.deactivate();
                LOGGER.info("Plugin initialized: {}", plugin.getClass().getName());
            } catch (Exception e) {
                LOGGER.error("Plugin '{}' failed during registration: {}",
                        plugin.getClass().getName(), e.getMessage(), e);
            }
        });

        LOGGER.info("Total tools registered: {} (builtin={}, plugin={})",
                ToolRegistry.size(), builtinCount, ToolRegistry.size() - builtinCount);

        LOGGER.info("Alice Mod Adapter JE initialized successfully.");
        LOGGER.info("World context will be activated on SERVER_STARTED (host-only mode).");
    }
}
