package io.alice.mod.adapter.tcp;

import com.google.gson.JsonObject;
import io.alice.mod.adapter.tcp.JsonRpcMessage.Request;
import io.alice.mod.adapter.tcp.JsonRpcMessage.Response;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.concurrent.CompletableFuture;

/**
 * 握手认证管理器。
 * <p>
 * 遵循通信协议规范的握手流程：
 * <ol>
 *   <li>发送 {@code handshake} 请求（含 instance_id + auth_token）</li>
 *   <li>服务端验证 token，返回 session_id 和心跳间隔</li>
 * </ol>
 */
public final class HandshakeManager {

    private static final Logger LOG = LoggerFactory.getLogger(HandshakeManager.class);

    /** 握手请求的固定 id（数字 1）。 */
    private static final JsonRpcId HANDSHAKE_ID = JsonRpcId.of(1);

    private final HandshakeConfig config;

    /** 握手成功后服务端返回的信息。 */
    private volatile HandshakeResult result;

    public HandshakeManager(HandshakeConfig config) {
        this.config = config;
    }

    /**
     * 执行握手认证。
     *
     * @param sender 发送消息的回调
     * @return 包含握手结果的 Future
     */
    public CompletableFuture<HandshakeResult> handshake(Sender sender) {
        CompletableFuture<HandshakeResult> future = new CompletableFuture<>();

        JsonObject params = new JsonObject();
        params.addProperty("instance_id", config.instanceId());
        params.addProperty("auth_token", config.authToken());
        params.addProperty("version", config.version());
        params.addProperty("mod", config.modName());

        Request request = new Request(HANDSHAKE_ID, "handshake", params);
        String json = JsonRpcCodec.toJson(request);

        sender.send(json, HANDSHAKE_ID);

        LOG.info("Handshake sent: instance_id={}, version={}", config.instanceId(), config.version());
        return future;
    }

    /**
     * 处理握手响应。由 {@link TcpClient} 在收到对应响应时调用。
     */
    public HandshakeResult handleResponse(Response response) {
        JsonObject resultObj = response.result().getAsJsonObject();
        boolean success = resultObj.get("success").getAsBoolean();
        if (!success) {
            throw new HandshakeException("handshake returned success=false");
        }

        String sessionId = resultObj.get("session_id").getAsString();
        String serverVersion = resultObj.get("server_version").getAsString();
        int heartbeatInterval = resultObj.has("heartbeat_interval")
                ? resultObj.get("heartbeat_interval").getAsInt()
                : 10;

        this.result = new HandshakeResult(sessionId, serverVersion, heartbeatInterval);
        LOG.info("Handshake successful: session_id={}, server_version={}, heartbeat_interval={}s",
                sessionId, serverVersion, heartbeatInterval);
        return this.result;
    }

    /** 已握手成功？ */
    public boolean isAuthenticated() {
        return result != null;
    }

    /** 获取握手结果。 */
    public HandshakeResult getResult() {
        return result;
    }

    /** 重置状态（断线重连时调用）。 */
    public void reset() {
        this.result = null;
    }

    // ---- 内部类型 ----

    /** 握手配置。 */
    public record HandshakeConfig(
            String instanceId,
            String authToken,
            String version,
            String modName
    ) {}

    /** 握手成功结果。 */
    public record HandshakeResult(
            String sessionId,
            String serverVersion,
            int heartbeatInterval
    ) {}

    /** 发送接口。 */
    @FunctionalInterface
    public interface Sender {
        void send(String json, JsonRpcId requestId);
    }

    /** 握手异常。 */
    public static final class HandshakeException extends RuntimeException {
        public HandshakeException(String message) {
            super(message);
        }
    }
}
