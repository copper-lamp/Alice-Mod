package io.alice.mod.adapter;

import net.fabricmc.api.ClientModInitializer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Alice Mod 客户端专属入口。
 * <p>
 * 仅在 Minecraft 客户端侧调用。主要负责：
 * <ul>
 *   <li>客户端 GUI/渲染相关（如有）</li>
 *   <li>注册世界切换后的客户端侧状态清理（如有）</li>
 * </ul>
 * <p>
 * 注意：<strong>Alice Mod 不在此入口中启动 TCP 或假人管理器。</strong>
 * 世界上下文由 {@link AliceModServer} 在 {@code SERVER_STARTED} 事件中激活。
 * 客户端连接远程服务器时，{@code SERVER_STARTED} 不会触发，
 * 因此 Alice Mod 在客户端侧自动休眠（仅主机模式）。
 */
public class AliceModClient implements ClientModInitializer {

    private static final Logger LOG = LoggerFactory.getLogger("alice-mod-client");

    @Override
    public void onInitializeClient() {
        LOG.info("Alice Mod Client initializing...");
        // 客户端专属初始化（如注册按键绑定、HUD 渲染等）
        // 当前暂无客户端 GUI 需求
        LOG.info("Alice Mod Client initialized.");
    }
}
