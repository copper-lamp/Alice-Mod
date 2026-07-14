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
 *   <li>发送 {@code handshake} 请求（含 instance_id + auth_token + version + mod）</li>
 *   <li>服务端验证 token，返回 session_id / server_version / heartbeat_interval</li>
 *   <li>验证失败时返回 JSON-RPC 错误码 -32001</li>
 * </ol>
 */
public final class HandshakeManager {

    private static final Logger LOG = LoggerFactory.getLogger(HandshakeManager.class);

    /** 握手请求的固定 id（数字 1）。 */
    public static final JsonRpcId HANDSHAKE_ID = JsonRpcId.of(1);

    private final HandshakeConfig config;

    /** 握手成功后服务端返回的信息。 */
    private volatile HandshakeResult result;

    /** 待完成的 Future（由 handshake() 创建，handleResponse() 完成）。 */
    private CompletableFuture<HandshakeResult> pendingFuture;

    public HandshakeManager(HandshakeConfig config) {
        this.config = config;
    }

    /**
     * 执行握手认证。
     * <p>
     * 发送 handshake 请求后返回 Future，
     * 收到服务端响应时由 {@link #handleResponse(Response)} 完成该 Future。
     *
     * @param sender 发送消息的回调
     * @return 包含握手结果的 Future（由 handleResponse 完成）
     */
    public CompletableFuture<HandshakeResult> handshake(Sender sender) {
        CompletableFuture<HandshakeResult> future = new CompletableFuture<>();
        this.pendingFuture = future;

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
     *
     * @param response 服务端返回的响应
     * @return 握手结果
     * @throws HandshakeException 握手失败时抛出
     */
    public HandshakeResult handleResponse(Response response) {
        JsonObject resultObj = response.result().getAsJsonObject();
        boolean success = resultObj.get("success").getAsBoolean();
        if (!success) {
            HandshakeException ex = new HandshakeException("handshake returned success=false");
            completeFutureExceptionally(ex);
            throw ex;
        }

        String sessionId = resultObj.get("session_id").getAsString();
        String serverVersion = resultObj.get("server_version").getAsString();
        int heartbeatInterval = resultObj.has("heartbeat_interval")
                ? resultObj.get("heartbeat_interval").getAsInt()
                : 10;

        this.result = new HandshakeResult(sessionId, serverVersion, heartbeatInterval);
        LOG.info("Handshake successful: session_id={}, server_version={}, heartbeat_interval={}s",
                sessionId, serverVersion, heartbeatInterval);

        // 完成 Future
        completeFuture(this.result);

        return this.result;
    }

    /**
     * 处理握手错误响应（服务端返回 JSON-RPC Error）。
     */
    public void handleError(JsonRpcMessage.Error error) {
        String msg = String.format("Handshake rejected: code=%d, message=%s",
                error.error().code(), error.error().message());
        HandshakeException ex = new HandshakeException(msg);
        completeFutureExceptionally(ex);
        throw ex;
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
        this.pendingFuture = null;
    }

    // ---- 内部辅助 ----

    private void completeFuture(HandshakeResult result) {
        if (pendingFuture != null && !pendingFuture.isDone()) {
            pendingFuture.complete(result);
            pendingFuture = null;
        }
    }

    private void completeFutureExceptionally(HandshakeException ex) {
        if (pendingFuture != null && !pendingFuture.isDone()) {
            pendingFuture.completeExceptionally(ex);
            pendingFuture = null;
        }
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
