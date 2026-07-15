package io.alice.mod.adapter.world;

import io.alice.mod.adapter.bot.BotManager;
import io.alice.mod.adapter.config.AlicePaths;
import io.alice.mod.adapter.config.ConfigManager;
import io.alice.mod.adapter.entry.InstanceFileGenerator;
import io.alice.mod.adapter.persistence.ConfigRepository;
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
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerTickEvents;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.phys.Vec3;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import io.alice.mod.adapter.agent.AgentConfig;
import io.alice.mod.adapter.agent.AgentConfigReader;

import java.nio.file.Path;
import java.sql.SQLException;
import java.util.List;
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

    /** 配置管理器（V12 新增）。 */
    private final ConfigManager configManager;

    /** V21: 当前世界加载的智能体配置列表。 */
    private List<AgentConfig> agentConfigs = List.of();

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
        this.configManager = createConfigManager(server);
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

        // 3. 初始化配置管理器（V12 新增）
        configManager.init();
        LOG.info("ConfigManager initialized for world '{}'", identity.worldName());

        // 5. V21: 加载智能体配置并创建主智能体假人
        loadAndSpawnAgents();

        // 6. 注册服务端 tick 事件（假人重生检查）
        ServerTickEvents.END_SERVER_TICK.register(s -> botManager.tick());

        // 7. 注册 TcpClient 实例供 TcpService 使用
        TcpServiceImpl.setClient(tcpClient);

        // 8. 生成入口 JSON 文件，供 AC 发现实例和校验 auth_token
        generateInstanceFile(false);

        // 9. 启动 TCP 客户端（连接 Agent Core）
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

        // 2. 关闭配置管理器（V12 新增）
        configManager.shutdown();

        // 3. 通知 Agent Core 世界下线
        sendWorldOffline();

        // 4. 断开 TCP
        tcpClient.disconnect();

        // 5. 清理 BotManager
        botManager.shutdown();

        // 6. 清理旧日志并关闭数据库
        try {
            databaseManager.cleanOldLogs(10_000, 5_000);
        } catch (Exception e) {
            LOG.warn("Log cleanup failed during shutdown for world '{}'", identity.worldName(), e);
        }
        databaseManager.close();

        // 7. 清除静态委托
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

                // 更新入口文件为在线状态
                generateInstanceFile(true);

                registerTools();
                statusCollector.start();
            }

            @Override
            public void onDisconnected() {
                LOG.warn("TCP connection lost for world '{}'", identity.worldName());
                statusCollector.stop();

                // 更新入口文件为离线状态
                generateInstanceFile(false);
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
     * 解析数据库文件路径，使用 AlicePaths 工具类。
     * <p>
     * 单人存档：Alice/worlds/&lt;WorldName&gt;/mcagent.db
     * 专用服务器：Alice/worlds/dedicated/mcagent.db
     */
    private static Path resolveDbPath(MinecraftServer server, WorldIdentity identity) {
        String worldDirName = AlicePaths.sanitize(
                server.isDedicatedServer() ? "dedicated" : server.getWorldData().getLevelName());
        return AlicePaths.worldDbPath(server.getServerDirectory(), worldDirName);
    }

    /**
     * 生成入口 JSON 文件（mcagent_instance.json）。
     * <p>
     * 在 TCP 连接前生成，确保 AC 能读取到正确的 auth_token 用于握手校验。
     *
     * @param online 是否标记为在线状态
     */
    private void generateInstanceFile(boolean online) {
        try {
            String gameDir = server.getServerDirectory().toString();
            InstanceFileGenerator.generate(
                    gameDir,
                    identity.instanceId(),
                    identity.authToken(),
                    online,
                    identity.worldName(),
                    DEFAULT_HOST,
                    DEFAULT_PORT,
                    "java",
                    getGameVersion()
            );
        } catch (Exception e) {
            LOG.warn("Failed to generate instance file for world '{}'", identity.worldName(), e);
        }
    }

    /** 获取游戏版本号。 */
    private static String getGameVersion() {
        return FabricLoader.getInstance()
                .getModContainer("minecraft")
                .map(c -> c.getMetadata().getVersion().getFriendlyString())
                .orElse("unknown");
    }

    private ConfigManager createConfigManager(MinecraftServer server) {
        ConfigManager cm = new ConfigManager(server.getServerDirectory(),
                new ConfigManager.ConfigRepositoryProxy() {
                    @Override
                    public Map<String, String> getAll() {
                        return databaseManager.configs().getAll();
                    }
                    @Override
                    public void set(String key, String value) {
                        databaseManager.configs().set(key, value);
                    }
                });

        // 注册配置变更监听器，通过 TCP 通知 Agent Core
        cm.addListener(event -> {
            try {
                JsonObject params = new JsonObject();
                JsonArray changes = new JsonArray();
                JsonObject change = new JsonObject();
                change.addProperty("key", event.key());
                change.addProperty("old_value", event.oldValue());
                change.addProperty("new_value", event.newValue());
                changes.add(change);
                params.add("changes", changes);
                params.addProperty("source", event.source());
                tcpClient.sendNotification("config_update", params);
                LOG.debug("Config change notified: {} = {}", event.key(), event.newValue());
            } catch (Exception e) {
                LOG.warn("Failed to send config_update notification", e);
            }
        });

        return cm;
    }

    // ---- 访问器 ---- //

    public MinecraftServer getServer() { return server; }
    public WorldIdentity getIdentity() { return identity; }
    public BotManager getBotManager() { return botManager; }
    public TcpClient getTcpClient() { return tcpClient; }
    public StatusCollector getStatusCollector() { return statusCollector; }
    public EventDispatcher getEventDispatcher() { return eventDispatcher; }
    public DatabaseManager getDatabaseManager() { return databaseManager; }
    public ConfigManager getConfigManager() { return configManager; }
    public List<AgentConfig> getAgentConfigs() { return agentConfigs; }
    public long getUptimeMs() { return System.currentTimeMillis() - startTime; }

    // ---- V21: 智能体配置加载与假人生成 ---- //

    /**
     * 从 Alice/agents/ 目录加载智能体配置，并为 isMain=true 的智能体创建假人。
     * <p>
     * 在 {@link #initialize()} 中调用，在 BotManager 初始化之后、TCP 连接之前执行。
     * 假人将生成在世界出生点位置。
     */
    private void loadAndSpawnAgents() {
        try {
            Path gameDir = server.getServerDirectory();
            agentConfigs = AgentConfigReader.readAll(gameDir);
            LOG.info("Loaded {} agent configs from Alice/agents/", agentConfigs.size());

            int spawned = 0;
            for (AgentConfig agent : agentConfigs) {
                if (agent.isMain()) {
                    String botName = agent.botName();
                    try {
                        ServerLevel overworld = server.overworld();
                        Vec3 spawnPos = new Vec3(
                                overworld.getSharedSpawnPos().getX() + 0.5,
                                overworld.getSharedSpawnPos().getY(),
                                overworld.getSharedSpawnPos().getZ() + 0.5
                        );
                        botManager.spawn(botName, overworld, spawnPos);
                        spawned++;
                        LOG.info("Spawned main agent bot '{}' (agentId={})", botName, agent.agentId());
                    } catch (Exception e) {
                        LOG.warn("Failed to spawn bot for agent '{}' (name={}): {}",
                                agent.agentId(), botName, e.getMessage());
                    }
                }
            }
            LOG.info("Spawned {} main agent bots", spawned);
        } catch (Exception e) {
            LOG.warn("Failed to load and spawn agents: {}", e.getMessage());
        }
    }

    @Override
    public String toString() {
        return "WorldContext{world='" + identity.worldName()
                + "', instance=" + identity.instanceId()
                + ", uptime=" + getUptimeMs() + "ms}";
    }
}
