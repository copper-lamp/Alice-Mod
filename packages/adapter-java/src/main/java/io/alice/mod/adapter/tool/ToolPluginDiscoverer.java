package io.alice.mod.adapter.tool;

import io.alice.mod.adapter.api.AliceToolPlugin;
import net.fabricmc.loader.api.FabricLoader;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.ArrayList;
import java.util.List;

/**
 * 工具插件发现器。
 * <p>
 * 使用 Fabric Loader 的入口点 API 发现所有实现了 {@link AliceToolPlugin}
 * 并在 fabric.mod.json 中声明了 {@code "alice-mod:plugin"} 入口点的附属模组。
 */
public final class ToolPluginDiscoverer {

    private static final Logger LOG = LoggerFactory.getLogger(ToolPluginDiscoverer.class);

    /** Fabric 自定义入口点名称 */
    public static final String ENTRYPOINT_KEY = "alice-mod:plugin";

    private ToolPluginDiscoverer() {}

    /**
     * 发现并实例化所有附属模组插件。
     *
     * @return 插件实例列表（按 Fabric Loader 发现顺序）
     */
    public static List<AliceToolPlugin> discover() {
        List<AliceToolPlugin> plugins = new ArrayList<>();

        try {
            for (AliceToolPlugin plugin : FabricLoader.getInstance()
                    .getEntrypoints(ENTRYPOINT_KEY, AliceToolPlugin.class)) {
                plugins.add(plugin);
                LOG.info("Discovered Alice Tool Plugin: {}",
                        plugin.getClass().getName());
            }
        } catch (Exception e) {
            LOG.error("Failed to discover Alice Tool Plugins", e);
        }

        LOG.info("ToolPluginDiscoverer: found {} plugin(s)", plugins.size());
        return plugins;
    }
}
