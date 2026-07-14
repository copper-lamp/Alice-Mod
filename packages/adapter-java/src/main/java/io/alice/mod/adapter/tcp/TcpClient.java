package io.alice.mod.adapter.tcp;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import io.alice.mod.adapter.tcp.HandshakeManager.HandshakeConfig;
import io.alice.mod.adapter.tcp.HandshakeManager.HandshakeResult;
import io.alice.mod.adapter.tcp.JsonRpcCodec.ParseResult;
import io.alice.mod.adapter.tcp.JsonRpcMessage.Notification;
import io.alice.mod.adapter.tcp.JsonRpcMessage.Response;
import io.alice.mod.adapter.tcp.ReconnectManager.ReconnectHandler;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.SocketException;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Consumer;

/**
 * Alice Mod TCP 客户端。
 * <p>
 * 与 Agent Core 建立 TCP 长连接，遵循 JSON-RPC 2.0 协议通信。
 * 整合连接管理、JSON-RPC 编解码、消息分发、握手认证、心跳响应、断线重连。
 *
 * <h3>使用示例</h3>
 * <pre>{@code
 * TcpClient client = new TcpClient(config, callbacks);
 * client.connect("127.0.0.1", 27541);
 * // ...
 * client.disconnect();
 * }</pre>
 */
public final class TcpClient {

    private static final Logger LOG = LoggerFactory.getLogger(TcpClient.class);

    /** 默认 Agent Core 端口 */
    public static final int DEFAULT_PORT = 27541;

    /** 默认地址 */
    public static final String DEFAULT_HOST = "127.0.0.1";

    /** TCP 连接超时（毫秒） */
    private static final int CONNECT_TIMEOUT_MS = 5000;

    /** 读线程名称 */
    private static final String READ_THREAD_NAME = "alice-tcp-read";

    /** 共享调度器线程名称前缀 */
    private static final String SCHEDULER_THREAD_PREFIX = "alice-tcp-scheduler";

    // ---- 配置 ----

    private final ClientConfig config;
    private final Callbacks callbacks;

    // ---- 网络 ----

    private volatile Socket socket;
    private volatile OutputStream outputStream;
    private volatile BufferedReader reader;
    private volatile Thread readThread;

    // ---- 组件 ----

    private final MessageFrameCodec frameCodec = new MessageFrameCodec();
    private final AtomicInteger requestIdSeq = new AtomicInteger(1);
    private final Map<JsonRpcId, CompletableFuture<ParseResult>> pendingRequests = new ConcurrentHashMap<>();
    private final ScheduledExecutorService scheduler = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread t = new Thread(r, SCHEDULER_THREAD_PREFIX);
        t.setDaemon(true);
        return t;
    });

    private final HandshakeManager handshakeManager;
    private final HeartbeatManager heartbeatManager;
    private final ReconnectManager reconnectManager;

    // ---- 状态 ----

    private final AtomicBoolean connected = new AtomicBoolean(false);
    private volatile ConnectionState state = ConnectionState.DISCONNECTED;
    private final CopyOnWriteArrayList<Consumer<ConnectionState>> stateListeners = new CopyOnWriteArrayList<>();

    /**
     * @param config    客户端配置
     * @param callbacks 回调（工具调用、事件等）
     */
    public TcpClient(ClientConfig config, Callbacks callbacks) {
        this.config = config;
        this.callbacks = callbacks;

        HandshakeConfig hsConfig = new HandshakeConfig(
                config.instanceId(),
                config.authToken(),
                config.version(),
                config.modName()
        );
        this.handshakeManager = new HandshakeManager(hsConfig);
        this.heartbeatManager = new HeartbeatManager(this::sendNotification);
        this.reconnectManager = new ReconnectManager(scheduler, new TcpReconnectHandler());
    }

    // ---- 连接管理 ----

    /**
     * 连接到 Agent Core。
     *
     * @param host 服务端地址
     * @param port 服务端端口
     */
    public synchronized void connect(String host, int port) {
        if (connected.get()) {
            LOG.warn("Already connected, ignoring connect()");
            return;
        }
        setState(ConnectionState.CONNECTING);
        try {
            socket = new Socket();
            socket.connect(new InetSocketAddress(host, port), CONNECT_TIMEOUT_MS);
            socket.setKeepAlive(true);
            outputStream = socket.getOutputStream();
            reader = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8));

            // 启动读线程
            readThread = new Thread(this::readLoop, READ_THREAD_NAME);
            readThread.setDaemon(true);
            readThread.start();

            // 握手认证
            handshakeManager.reset();
            handshakeManager.handshake((json, id) -> {
                CompletableFuture<ParseResult> f = new CompletableFuture<>();
                pendingRequests.put(id, f);
                sendRaw(json);
            });

            LOG.info("TCP connected to {}:{}", host, port);
        } catch (IOException e) {
            LOG.error("Failed to connect to {}:{}", host, port, e);
            setState(ConnectionState.DISCONNECTED);
            cleanup();
        }
    }

    /** 使用默认地址连接。 */
    public void connect() {
        connect(DEFAULT_HOST, DEFAULT_PORT);
    }

    /**
     * 断开连接。
     */
    public synchronized void disconnect() {
        reconnectManager.stop();
        heartbeatManager.stop();
        cleanup();
        setState(ConnectionState.DISCONNECTED);
        LOG.info("TCP disconnected");
    }

    /** 是否已连接。 */
    public boolean isConnected() {
        return connected.get();
    }

    /** 获取当前连接状态。 */
    public ConnectionState getState() {
        return state;
    }

    /** 添加连接状态监听器。 */
    public void addStateListener(Consumer<ConnectionState> listener) {
        stateListeners.add(listener);
    }

    /** 移除连接状态监听器。 */
    public void removeStateListener(Consumer<ConnectionState> listener) {
        stateListeners.remove(listener);
    }

    // ---- 发送消息 ----

    /**
     * 发送 JSON-RPC 请求，返回异步结果。
     *
     * @param method 方法名
     * @param params 参数（可为 null）
     * @return 服务端响应的 Future
     */
    public CompletableFuture<ParseResult> sendRequest(String method, JsonElement params) {
        if (!connected.get()) {
            return CompletableFuture.failedFuture(new IOException("Not connected"));
        }
        JsonRpcId id = JsonRpcId.of(requestIdSeq.incrementAndGet());
        JsonRpcMessage.Request request = new JsonRpcMessage.Request(id, method, params);
        String json = JsonRpcCodec.toJson(request);

        CompletableFuture<ParseResult> future = new CompletableFuture<>();
        pendingRequests.put(id, future);
        sendRaw(json);
        return future;
    }

    /**
     * 发送 JSON-RPC 通知（无需响应）。
     *
     * @param method 方法名
     * @param params 参数（可为 null）
     */
    public void sendNotification(String method, JsonElement params) {
        if (!connected.get()) {
            return;
        }
        Notification notification = new Notification(method, params);
        sendNotification(notification);
    }

    /** 发送已构建好的通知。 */
    void sendNotification(Notification notification) {
        String json = JsonRpcCodec.toJson(notification);
        sendRaw(json);
    }

    // ---- 内部方法 ----

    private void sendRaw(String json) {
        if (outputStream == null) {
            return;
        }
        try {
            byte[] data = frameCodec.encode(json);
            outputStream.write(data);
            outputStream.flush();
        } catch (IOException e) {
            LOG.error("Failed to send message", e);
            onDisconnected();
        }
    }

    /** 读线程主循环。 */
    private void readLoop() {
        try {
            String line;
            while ((line = reader.readLine()) != null) {
                if (line.isEmpty()) {
                    continue;
                }
                try {
                    handleIncoming(line);
                } catch (Exception e) {
                    LOG.error("Error handling incoming message: {}", line, e);
                }
            }
        } catch (SocketException e) {
            // 正常断开
        } catch (IOException e) {
            LOG.error("Read thread error", e);
        } finally {
            onDisconnected();
        }
    }

    /** 处理收到的消息。 */
    private void handleIncoming(String line) {
        ParseResult result = JsonRpcCodec.parseBatch(line);
        switch (result) {
            case ParseResult.RequestResult r -> handleToolCall(r.message());
            case ParseResult.ResponseResult r -> handleResponse(r.message());
            case ParseResult.ErrorResult e -> handleError(e.message());
            case ParseResult.NotificationResult n -> handleNotification(n.message());
            case ParseResult.BatchResult b -> handleBatch(b.message());
            case ParseResult.Invalid i -> LOG.warn("Invalid message: {}", i.reason());
        }
    }

    /** 处理 Agent Core 发来的工具调用请求。 */
    private void handleToolCall(JsonRpcMessage.Request request) {
        LOG.debug("Received tool_call: method={}, id={}", request.method(), request.id());
        callbacks.onToolCall(request, this::sendResponse);
    }

    /** 处理服务端响应（匹配 pending 请求）。 */
    private void handleResponse(Response response) {
        CompletableFuture<ParseResult> future = pendingRequests.remove(response.id());
        if (future != null) {
            future.complete(ParseResult.response(response));
        }

        // 如果是握手响应（id 为数字 1）
        if (response.id().isNumber() && response.id().asInt() == 1 && !handshakeManager.isAuthenticated()) {
            try {
                HandshakeResult hsResult = handshakeManager.handleResponse(response);
                connected.set(true);
                setState(ConnectionState.CONNECTED);
                heartbeatManager.start();
                callbacks.onHandshakeSuccess(hsResult);
            } catch (Exception e) {
                LOG.error("Handshake failed", e);
                onDisconnected();
            }
        }
    }

    /** 处理错误响应。 */
    private void handleError(JsonRpcMessage.Error error) {
        LOG.warn("Received error: code={}, message={}", error.error().code(), error.error().message());
        CompletableFuture<ParseResult> future = pendingRequests.remove(error.id());
        if (future != null) {
            future.complete(ParseResult.error(error));
        }
    }

    /** 处理通知消息。 */
    private void handleNotification(Notification notification) {
        switch (notification.method()) {
            case "ping" -> heartbeatManager.handlePing();
            case "config_update" -> callbacks.onConfigUpdate(notification.params());
            default -> LOG.debug("Unknown notification: {}", notification.method());
        }
    }

    /** 处理批量消息。 */
    private void handleBatch(JsonRpcMessage.Batch batch) {
        for (JsonElement elem : batch.messages()) {
            handleIncoming(elem.toString());
        }
    }

    /** 发送响应（用于工具调用结果回传）。 */
    public void sendResponse(JsonRpcId id, JsonElement result) {
        Response response = new Response(id, result);
        String json = JsonRpcCodec.toJson(response);
        sendRaw(json);
    }

    /** 连接断开处理。 */
    private void onDisconnected() {
        if (!connected.get()) {
            return;
        }
        connected.set(false);
        heartbeatManager.stop();
        cleanup();

        // 取消所有 pending 请求
        for (Map.Entry<JsonRpcId, CompletableFuture<ParseResult>> entry : pendingRequests.entrySet()) {
            entry.getValue().completeExceptionally(new IOException("Connection lost"));
        }
        pendingRequests.clear();

        setState(ConnectionState.RECONNECTING);
        callbacks.onDisconnected();

        // 启动重连
        if (config.autoReconnect()) {
            reconnectManager.startFresh();
        }
    }

    /** 清理网络资源。 */
    private void cleanup() {
        try {
            if (reader != null) reader.close();
        } catch (IOException ignored) {}
        try {
            if (outputStream != null) outputStream.close();
        } catch (IOException ignored) {}
        try {
            if (socket != null && !socket.isClosed()) socket.close();
        } catch (IOException ignored) {}
        reader = null;
        outputStream = null;
        socket = null;
        readThread = null;
        frameCodec.reset();
    }

    private void setState(ConnectionState newState) {
        this.state = newState;
        for (Consumer<ConnectionState> listener : stateListeners) {
            try {
                listener.accept(newState);
            } catch (Exception e) {
                LOG.warn("State listener error", e);
            }
        }
    }

    // ---- 重连处理器 ----

    private class TcpReconnectHandler implements ReconnectHandler {
        @Override
        public boolean onReconnect(int attemptNumber) {
            setState(ConnectionState.RECONNECTING);
            try {
                connect(config.host(), config.port());
                return connected.get();
            } catch (Exception e) {
                LOG.warn("Reconnect attempt {} failed", attemptNumber, e);
                return false;
            }
        }

        @Override
        public void onGiveUp() {
            LOG.error("All reconnect attempts exhausted, giving up");
            setState(ConnectionState.DISCONNECTED);
            callbacks.onReconnectFailed();
        }
    }

    // ---- 配置 ----

    /** TCP 客户端配置。 */
    public record ClientConfig(
            String host,
            int port,
            String instanceId,
            String authToken,
            String version,
            String modName,
            boolean autoReconnect
    ) {
        public static final String DEFAULT_VERSION = "1.0.0";
        public static final String DEFAULT_MOD_NAME = "alice-mod";

        public ClientConfig {
            if (host == null || host.isBlank()) host = DEFAULT_HOST;
            if (port <= 0) port = DEFAULT_PORT;
            if (version == null || version.isBlank()) version = DEFAULT_VERSION;
            if (modName == null || modName.isBlank()) modName = DEFAULT_MOD_NAME;
        }

        public ClientConfig(String instanceId, String authToken) {
            this(DEFAULT_HOST, DEFAULT_PORT, instanceId, authToken,
                    DEFAULT_VERSION, DEFAULT_MOD_NAME, true);
        }
    }

    // ---- 回调 ----

    /**
     * TCP 客户端回调接口。
     * <p>
     * 由使用方（如 AliceModAdapter）实现，处理工具调用和连接事件。
     */
    public interface Callbacks {
        /**
         * 收到工具调用请求。
         *
         * @param request  工具调用请求
         * @param respond  发送响应：{@code (id, resultJson) → void}
         */
        void onToolCall(JsonRpcMessage.Request request, BiConsumer<JsonRpcId, JsonElement> respond);

        /**
         * 握手成功。
         *
         * @param result 握手结果（session_id, server_version, heartbeat_interval）
         */
        default void onHandshakeSuccess(HandshakeResult result) {}

        /** 连接断开。 */
        default void onDisconnected() {}

        /** 收到配置更新通知。 */
        default void onConfigUpdate(JsonElement params) {}

        /** 所有重连尝试均已失败。 */
        default void onReconnectFailed() {}
    }

    /** 双参数消费者（用于工具调用响应）。 */
    @FunctionalInterface
    public interface BiConsumer<T, U> {
        void accept(T t, U u);
    }
}
