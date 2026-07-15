package io.alice.mod.adapter.world;

import io.alice.mod.adapter.bot.BotManager;
import io.alice.mod.adapter.persistence.DatabaseManager;
import io.alice.mod.adapter.persistence.EventLogRepository;
import io.alice.mod.adapter.persistence.ToolLogRepository;
import io.alice.mod.adapter.status.EventDispatcher;
import io.alice.mod.adapter.status.StatusCollector;
import io.alice.mod.adapter.status.StatusData;
import io.alice.mod.adapter.tcp.TcpClient;
import io.alice.mod.adapter.tcp.TcpClient.Callbacks;
import io.alice.mod.adapter.tcp.TcpClient.ClientConfig;
import io.alice.mod.adapter.tcp.HandshakeManager.HandshakeResult;
import io.alice.mod.adapter.tcp.JsonRpcId;
import io.alice.mod.adapter.tcp.JsonRpcMessage;
import io.alice.mod.adapter.tool.AliceTool;
import io.alice.mod.adapter.tool.SchemaGenerator;
import io.alice.mod.adapter.tool.ToolRegistry;
import io.alice.mod.adapter.tool.ToolResult;
import io.alice.mod.adapter.tool.service.TcpServiceImpl;
import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerTickEvents;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.server.MinecraftServer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.nio.file.Path;
import java.sql.SQLException;
import java.util.Map;
import java.util.UUID;

/**
 * 世界上下文 — 每个 Minecraft 世界（存档/服务器）对应一个实例。
 * <p>
 * 封装该世界生命周期内的所有组件：TCP 连接、假人管理器、状态采集器、事件分发器。
 * 世界切换时，旧上下文关闭 → 新上下文创建。
 */
public class WorldContext {

    private static final Logger LOG = LoggerFactory.getLogger(WorldContext.class);

    /** MinecraftServer 引用。 */
    private final MinecraftServer server;

    /** 世界身份。 */
    private final WorldIdentity identity;

    /** TCP 客户端（与 Agent Core 通信）。 */
    private final TcpClient tcpClient;

    /** 假人管理器（该世界的假人实例集合）。 */
    private final BotManager botManager;

    /** 状态采集器（周期性上报世界状态）。 */
    private final StatusCollector statusCollector;

    /** 事件分发器。 */
    private final EventDispatcher eventDispatcher;

    /** 上下文启动时间戳。 */
    private final long startTime;

    /** 数据库管理器（V11 新增）。 */
    private final DatabaseManager databaseManager;

    /** JSON 序列化。 */
    private static final Gson GSON = new GsonBuilder().disableHtmlEscaping().create();

    /** 模组级通用配置中的主机和端口。 */
    private static final String DEFAULT_HOST = "127.0.0.1";
    private static final int DEFAULT_PORT = 27541;

    public WorldContext(MinecraftServer server, WorldIdentity identity) {
        this.server = server;
        this.identity = identity;
        this.botManager = new BotManager(server);
        this.eventDispatcher = new EventDispatcher(this::sendEvent);
        this.tcpClient = createTcpClient();
        this.statusCollector = new StatusCollector(
                this::collectStatus,
                statusData -> {
                    JsonObject params = statusData.toJson();
                    tcpClient.sendNotification("status_report", params);
                }
        );
        this.databaseManager = createDatabaseManager(server, identity);
        this.startTime = System.currentTimeMillis();
    }

    /**
     * 初始化上下文。
     * <p>
     * 注意：<strong>必须先设置 BotManager 的活跃引用</strong>，再初始化其他组件。
     * 因为现有工具代码通过静态方法调用 BotManager，过渡期内需要静态委托。
     */
    public void initialize() {
        // 0. 注册 BotManager 实例到静态委托（过渡期：旧代码通过静态方法访问）
        BotManager.setCurrentContext(this);

        // 1. BotManager 初始化（从 SavedData 恢复假人注册表）
        botManager.init(server);

        // 2. 初始化数据库
        try {
            databaseManager.initialize();
            LOG.info("Database initialized for world '{}'", identity.worldName());
        } catch (SQLException e) {
            LOG.error("Failed to initialize database for world '{}'", identity.worldName(), e);
        }

        // 3. 注册服务端 tick 事件（假人重生检查）
        ServerTickEvents.END_SERVER_TICK.register(s -> botManager.tick());

        // 4. 注册 TcpClient 实例供 TcpService 使用
        TcpServiceImpl.setClient(tcpClient);

        // 5. 启动 TCP 客户端（连接 Agent Core）
        tcpClient.connect(DEFAULT_HOST, DEFAULT_PORT);

        LOG.info("WorldContext initialized: world='{}', uptime={}ms",
                identity.worldName(), getUptimeMs());
    }

    /**
     * 关闭上下文。
     * <p>
     * 在 {@code ServerLifecycleEvents.SERVER_STOPPING} 中调用。
     */
    public void shutdown() {
        LOG.info("WorldContext shutting down: world='{}', uptime={}ms",
                identity.worldName(), getUptimeMs());

        // 1. 停止状态上报
        statusCollector.stop();

        // 2. 通知 Agent Core 世界下线
        sendWorldOffline();

        // 3. 断开 TCP
        tcpClient.disconnect();

        // 4. 清理 BotManager
        botManager.shutdown();

        // 5. 清理旧日志并关闭数据库
        try {
            databaseManager.cleanOldLogs(10_000, 5_000);
        } catch (Exception e) {
            LOG.warn("Log cleanup failed during shutdown for world '{}'", identity.worldName(), e);
        }
        databaseManager.close();

        // 6. 清除静态委托
        BotManager.clearCurrentContext();
    }

    // ---- TCP 客户端 ---- //

    private TcpClient createTcpClient() {
        ClientConfig config = new ClientConfig(
                DEFAULT_HOST,
                DEFAULT_PORT,
                identity.instanceId(),
                identity.authToken(),
                "1.0.0",
                "alice-mod",
                true
        );

        return new TcpClient(config, new Callbacks() {
            @Override
            public void onToolCall(JsonRpcMessage.Request request,
                                   TcpClient.BiConsumer<JsonRpcId, JsonElement> respond) {
                handleToolCall(request, respond);
            }

            @Override
            public void onHandshakeSuccess(HandshakeResult result) {
                LOG.info("Handshake success: session={}, world='{}'",
                        result.sessionId(), identity.worldName());

                registerTools();
                statusCollector.start();
            }

            @Override
            public void onDisconnected() {
                LOG.warn("TCP connection lost for world '{}'", identity.worldName());
                statusCollector.stop();
            }

            @Override
            public void onReconnectFailed() {
                LOG.error("All reconnect attempts failed for world '{}'", identity.worldName());
            }
        });
    }

    // ---- 工具注册 ---- //

    private void registerTools() {
        var tools = ToolRegistry.all();
        if (tools.isEmpty()) {
            LOG.warn("No tools registered, skipping registration");
            return;
        }

        JsonObject payload = SchemaGenerator.generateRegisterPayload(tools);
        LOG.info("Registering {} tools with Agent Core (world='{}')",
                tools.size(), identity.worldName());

        tcpClient.sendRequest("register_tools", payload)
                .thenAccept(result -> result.asResponse().ifPresentOrElse(
                        response -> {
                            JsonObject data = response.result().getAsJsonObject();
                            int count = data.get("registered_count").getAsInt();
                            LOG.info("Tools registered: {} (confirmed by Agent Core, world='{}')",
                                    count, identity.worldName());
                        },
                        () -> LOG.warn("register_tools response not received")
                ))
                .exceptionally(e -> {
                    LOG.error("Failed to register tools for world '{}'",
                            identity.worldName(), e);
                    return null;
                });
    }

    // ---- 工具调用 ---- //

    private void handleToolCall(JsonRpcMessage.Request request,
                                TcpClient.BiConsumer<JsonRpcId, JsonElement> respond) {
        JsonObject params = request.params() != null
                ? request.params().getAsJsonObject()
                : new JsonObject();
        String toolName = params.has("tool_name")
                ? params.get("tool_name").getAsString()
                : "unknown";

        LOG.info("Tool call: tool={}, world='{}'", toolName, identity.worldName());

        // 解析参数
        JsonElement paramsElement = params.get("parameters");
        @SuppressWarnings("unchecked")
        Map<String, Object> args = paramsElement != null
                ? Map.of()
                : Map.of();

        // 查找并执行工具
        AliceTool tool = ToolRegistry.get(toolName);
        if (tool == null) {
            JsonObject error = new JsonObject();
            error.addProperty("success", false);
            error.addProperty("message", "Tool not found: " + toolName);
            respond.accept(request.id(), error);
            return;
        }

        long start = System.currentTimeMillis();
        ToolResult result = tool.invoke(args);
        long duration = System.currentTimeMillis() - start;

        // 记录工具执行日志（V11）
        if (databaseManager.isInitialized()) {
            try {
                databaseManager.toolLogs().insert(new ToolLogRepository.ToolLogEntry(
                        0, toolName,
                        paramsElement != null ? paramsElement.toString() : "{}",
                        result.success(), result.message(), duration,
                        identity.worldName(), identity.instanceId(), "", null
                ));
            } catch (Exception e) {
                LOG.warn("Failed to log tool call: tool={}", toolName, e);
            }
        }

        JsonObject response = new JsonObject();
        response.addProperty("success", result.success());
        response.addProperty("message", result.message());
        response.addProperty("duration_ms", duration);
        if (result.data() != null && !result.data().isEmpty()) {
            JsonObject dataObj = new JsonObject();
            for (Map.Entry<String, Object> entry : result.data().entrySet()) {
                Object v = entry.getValue();
                if (v instanceof Number n) dataObj.addProperty(entry.getKey(), n);
                else if (v instanceof Boolean b) dataObj.addProperty(entry.getKey(), b);
                else if (v != null) dataObj.addProperty(entry.getKey(), v.toString());
            }
            response.add("data", dataObj);
        }

        respond.accept(request.id(), response);
        LOG.info("Tool '{}' completed in {}ms: success={}", toolName, duration, result.success());
    }

    // ---- 世界下线通知 ---- //

    private void sendWorldOffline() {
        JsonObject params = new JsonObject();
        params.addProperty("instance_id", identity.instanceId());
        params.addProperty("world_name", identity.worldName());
        params.addProperty("uptime_seconds", getUptimeMs() / 1000);
        params.addProperty("reason", "world_switch");
        tcpClient.sendNotification("world_offline", params);
        LOG.info("Sent world_offline: world='{}'", identity.worldName());
    }

    // ---- 事件通知 ---- //

    private void sendEvent(JsonObject eventJson) {
        tcpClient.sendNotification("event", eventJson);
    }

    // ---- 状态采集 ---- //

    private StatusData collectStatus() {
        // 临时实现，后续接入真实游戏状态
        return new StatusData(
                20.0, 20.0, 20, 20, 5.0f,
                300, 300, 0.0, 64.0, 0.0,
                "overworld", 0.0f, 0.0f, 0, 0,
                "air", "air", "air", "air", "air", "air",
                0, 36,
                java.util.List.of(), java.util.List.of(),
                6000, "clear", "normal", "survival"
        );
    }

    // ---- 数据库管理 ---- //

    private static DatabaseManager createDatabaseManager(MinecraftServer server, WorldIdentity identity) {
        Path dbPath = resolveDbPath(server, identity);
        return new DatabaseManager(dbPath, identity.worldName(), identity.instanceId());
    }

    /**
     * 解析数据库文件路径，与 WorldIdentity 的路径逻辑一致。
     * <p>
     * 单人存档：saves/&lt;WorldName&gt;/config/mcagent/worlds/&lt;WorldName&gt;/mcagent.db
     * 专用服务器：config/mcagent/worlds/dedicated/mcagent.db
     */
    private static Path resolveDbPath(MinecraftServer server, WorldIdentity identity) {
        Path configDir = server.getServerDirectory().resolve("config/mcagent");
        String worldDirName = sanitizeWorldName(
                server.isDedicatedServer() ? "dedicated" : server.getWorldData().getLevelName());

        return configDir.resolve("worlds").resolve(worldDirName).resolve("mcagent.db");
    }

    /** 清理世界名中的特殊字符。 */
    private static String sanitizeWorldName(String name) {
        return name.replaceAll("[^a-zA-Z0-9_\\-]", "_");
    }

    // ---- 访问器 ---- //

    public MinecraftServer getServer() { return server; }
    public WorldIdentity getIdentity() { return identity; }
    public BotManager getBotManager() { return botManager; }
    public TcpClient getTcpClient() { return tcpClient; }
    public StatusCollector getStatusCollector() { return statusCollector; }
    public EventDispatcher getEventDispatcher() { return eventDispatcher; }
    public DatabaseManager getDatabaseManager() { return databaseManager; }
    public long getUptimeMs() { return System.currentTimeMillis() - startTime; }

    @Override
    public String toString() {
        return "WorldContext{world='" + identity.worldName()
                + "', instance=" + identity.instanceId()
                + ", uptime=" + getUptimeMs() + "ms}";
    }
}
