package io.alice.mod.adapter.bot;

import io.netty.channel.embedded.EmbeddedChannel;
import net.minecraft.network.Connection;
import net.minecraft.network.DisconnectionDetails;
import net.minecraft.network.PacketSendListener;
import net.minecraft.network.chat.Component;
import net.minecraft.network.protocol.Packet;
import net.minecraft.network.protocol.PacketFlow;

import java.util.function.Consumer;

/**
 * 假人网络连接 — 空实现（丢弃模式）。
 * <p>
 * 假人没有真实的客户端连接，所以所有出站包直接丢弃。
 * 使用 {@link EmbeddedChannel} 满足 {@code placeNewPlayer} 的管道初始化要求。
 * {@code isConnected()} 返回 {@code true} 以保证玩家实体被正常 tick 和 chunk 跟踪。
 * 生命周期由 {@link BotManager} 管理，不受连接状态影响。
 */
public final class FakeConnection extends Connection {

    public FakeConnection() {
        super(PacketFlow.SERVERBOUND);
        // 注册到 EmbeddedChannel 触发 channelActive → 设置 this.channel
        // 使得 placeNewPlayer 的管道初始化不会 NPE
        new EmbeddedChannel(this);
    }

    /** 丢弃所有出站包 — 没有客户端接收。 */
    @Override
    public void send(Packet<?> packet, PacketSendListener listener, boolean flush) {
        // no-op
    }

    /** 不缓存待连接时的操作。 */
    @Override
    public void runOnceConnected(Consumer<Connection> action) {
        // no-op
    }

    /** 报告在线，使玩家实体 tick 和 chunk 跟踪正常进行。 */
    @Override
    public boolean isConnected() {
        return true;
    }

    /** 不驱动包监听器的 tick（避免 keep-alive 检查）。 */
    @Override
    public void tick() {
        // no-op
    }

    /** 禁用 keep-alive 超时断开。 */
    @Override
    public void disconnect(Component message) {
        // no-op
    }

    @Override
    public void disconnect(DisconnectionDetails details) {
        // no-op
    }

    @Override
    public void handleDisconnection() {
        // no-op
    }

    @Override
    public void flushChannel() {
        // no-op
    }

    @Override
    public void setReadOnly() {
        // no-op
    }
}