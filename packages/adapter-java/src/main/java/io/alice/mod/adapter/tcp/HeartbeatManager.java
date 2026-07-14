package io.alice.mod.adapter.tcp;

import com.google.gson.JsonObject;
import io.alice.mod.adapter.tcp.JsonRpcMessage.Notification;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.time.Instant;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;

/**
 * 心跳管理器。
 * <p>
 * 响应 Agent Core 的 {@code ping} 通知，回复 {@code pong} 通知。
 * 由 {@link TcpClient} 在收到 ping 时调用 {@link #handlePing()}。
 */
public final class HeartbeatManager {

    private static final Logger LOG = LoggerFactory.getLogger(HeartbeatManager.class);

    private final AtomicBoolean active = new AtomicBoolean(false);
    private final Consumer<Notification> sender;
    private long lastPingTime;

    /**
     * @param sender 用于发送 pong 消息的回调，通常指向 {@code TcpClient.send}
     */
    public HeartbeatManager(Consumer<Notification> sender) {
        this.sender = sender;
    }

    /** 启动心跳管理器。 */
    public void start() {
        active.set(true);
        LOG.debug("Heartbeat manager started");
    }

    /** 停止心跳管理器。 */
    public void stop() {
        active.set(false);
        LOG.debug("Heartbeat manager stopped");
    }

    /** 是否活跃。 */
    public boolean isActive() {
        return active.get();
    }

    /** 获取最后一次收到 ping 的时间戳。 */
    public long getLastPingTime() {
        return lastPingTime;
    }

    /**
     * 处理收到的 {@code ping} 通知。
     * <p>
     * 按照协议回复 {@code pong} 消息：
     * <pre>
     * {"jsonrpc":"2.0","method":"pong","params":{"timestamp":"...","tick":...}}
     * </pre>
     */
    public void handlePing() {
        if (!active.get()) {
            return;
        }
        lastPingTime = System.currentTimeMillis();

        JsonObject params = new JsonObject();
        params.addProperty("timestamp", Instant.now().toString());
        params.addProperty("tick", System.currentTimeMillis() / 50); // 近似 tick

        Notification pong = new Notification("pong", params);
        sender.accept(pong);

        LOG.debug("Heartbeat: ping → pong");
    }
}
