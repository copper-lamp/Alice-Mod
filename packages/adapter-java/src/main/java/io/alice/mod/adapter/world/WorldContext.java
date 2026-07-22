package io.alice.mod.adapter.world;

import io.alice.mod.adapter.bot.BotEventDispatcher;
import io.alice.mod.adapter.bot.BotManager;
import io.alice.mod.adapter.config.AlicePaths;
import io.alice.mod.adapter.config.ConfigManager;
import io.alice.mod.adapter.entry.InstanceFileGenerator;
import io.alice.mod.adapter.status.MixinEventBridge;
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
import net.fabricmc.fabric.api.networking.v1.ServerPlayConnectionEvents;
import net.fabricmc.loader.api.FabricLoader;
import carpet.patches.EntityPlayerMPFake;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.phys.Vec3;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import io.alice.mod.adapter.agent.AgentConfig;
import io.alice.mod.adapter.agent.AgentConfigReader;
import io.alice.mod.adapter.ai.BotAccess;
import io.alice.mod.adapter.ai.behavior.TaskRunner;
import io.alice.mod.adapter.ai.behavior.chain.UserTaskChain;
import io.alice.mod.adapter.api.service.BotHandle;
import io.alice.mod.adapter.ai.condition.ConditionMonitor;
import io.alice.mod.adapter.tool.service.PathfindingServiceImpl;

import java.nio.file.Path;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

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

    /** 行为树任务运行器。 */
    private TaskRunner taskRunner;

    /** 用户任务链。 */
    private UserTaskChain userTaskChain;

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

        // 1.5. 注册假人生命周期事件监听器（桥接 BotEventDispatcher → EventDispatcher → TCP）
        registerBotEventListeners();

        // 1.6. 设置 Mixin 事件桥接器（供 ChatEventMixin / AttackEventMixin 使用）
        MixinEventBridge.setDispatcher(eventDispatcher);

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

        // 5.5. 初始化行为树系统
        initializeBehaviorTree();

        // 6. 注册服务端 tick 事件（假人重生检查 + 健康度检测 + 行为树驱动）
        ServerTickEvents.END_SERVER_TICK.register(s -> {
            botManager.tick();
            checkBotHealth();
            tickBehaviorTree();
        });

        // 6.5. 注册玩家连接事件（加入/离开）
        registerPlayerEventListeners();

        // 7. 注册 TcpClient 实例供 TcpService 使用
        TcpServiceImpl.setClient(tcpClient);

        // 8. 生成入口 JSON 文件，供 AC 发现实例和校验 auth_token
        generateInstanceFile(false);

        // 9. 启动 TCP 客户端（连接 Agent Core），连接失败时启动后台重连
        tcpClient.connect(DEFAULT_HOST, DEFAULT_PORT);
        tcpClient.startReconnect();

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

        // 5.5. 清理 Mixin 事件桥接器
        MixinEventBridge.clear();

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
                true,
                identity.worldName()
        );

        return new TcpClient(config, new Callbacks() {
            @Override
            public void onToolCall(JsonRpcMessage.Request request,
                                   TcpClient.BiConsumer<JsonRpcId, JsonElement> respond) {
                handleToolCall(request, respond);
            }

            @Override
            public void onBotControl(JsonRpcMessage.Request request,
                                     TcpClient.BiConsumer<JsonRpcId, JsonElement> respond) {
                handleBotControl(request, respond);
            }

            @Override
            public void onHandshakeSuccess(HandshakeResult result) {
                LOG.info("Handshake success: session={}, world='{}'",
                        result.sessionId(), identity.worldName());

                // 更新入口文件为在线状态
                generateInstanceFile(true);

                registerTools();
                sendWorldOnline();
                statusCollector.start();
            }

            @Override
            public void onDisconnected() {
                LOG.debug("TCP connection lost for world '{}'", identity.worldName());
                statusCollector.stop();

                // 更新入口文件为离线状态
                generateInstanceFile(false);
            }

            @Override
            public void onReconnectFailed() {
                LOG.debug("All reconnect attempts failed for world '{}'", identity.worldName());
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

        // 协议契约：register_tools 走 Notification（无需响应）
        // 历史曾误用 sendRequest，AC 端按 Notification 处理，导致方法名被拒绝，工具从未注册
        tcpClient.sendNotification("register_tools", payload);
        LOG.info("Tools registration notification sent: {} tools (world='{}')",
                tools.size(), identity.worldName());
    }

    // ---- 工具调用 ---- //

    /** 复用的 Gson 实例，用于 JSON 参数解析 */
    private static final Gson ARGS_GSON = new GsonBuilder().setLenient().create();

    /** 工具执行超时时间（秒）。 */
    private static final int TOOL_TIMEOUT_SECONDS = 30;

    private void handleToolCall(JsonRpcMessage.Request request,
                                TcpClient.BiConsumer<JsonRpcId, JsonElement> respond) {
        JsonObject params = request.params() != null
                ? request.params().getAsJsonObject()
                : new JsonObject();
        String toolName = params.has("tool_name")
                ? params.get("tool_name").getAsString()
                : "unknown";

        LOG.info("Tool call: tool={}, world='{}'", toolName, identity.worldName());

        // 解析参数（修复：原代码三元两支都返回 Map.of()，导致所有参数丢失）
        JsonElement paramsElement = params.get("parameters");
        Map<String, Object> args = parseJsonArgs(paramsElement);

        // 查找并执行工具
        AliceTool tool = ToolRegistry.get(toolName);
        if (tool == null) {
            JsonObject error = new JsonObject();
            error.addProperty("success", false);
            JsonObject errObj = new JsonObject();
            errObj.addProperty("reason", "TOOL_NOT_FOUND");
            errObj.addProperty("detail", "Tool not found: " + toolName);
            errObj.addProperty("suggestion", "Check available tools with register_tools response");
            error.add("error", errObj);
            respond.accept(request.id(), error);
            return;
        }

        long start = System.currentTimeMillis();

        // 异步执行工具，带超时
        ToolResult result;
        try {
            result = CompletableFuture.supplyAsync(() -> tool.invoke(args))
                    .get(TOOL_TIMEOUT_SECONDS, TimeUnit.SECONDS);
        } catch (TimeoutException e) {
            long duration = System.currentTimeMillis() - start;
            LOG.warn("Tool '{}' timed out after {}s", toolName, TOOL_TIMEOUT_SECONDS);
            JsonObject error = new JsonObject();
            error.addProperty("success", false);
            JsonObject errObj = new JsonObject();
            errObj.addProperty("reason", "TOOL_TIMEOUT");
            errObj.addProperty("detail", "Tool execution timed out after " + TOOL_TIMEOUT_SECONDS + "s");
            errObj.addProperty("suggestion", "Simplify the task or check if the bot is in a valid state");
            error.add("error", errObj);
            error.addProperty("duration_ms", duration);
            respond.accept(request.id(), error);
            return;
        } catch (Exception e) {
            long duration = System.currentTimeMillis() - start;
            LOG.warn("Tool '{}' execution failed: {}", toolName, e.getMessage());
            JsonObject error = new JsonObject();
            error.addProperty("success", false);
            JsonObject errObj = new JsonObject();
            errObj.addProperty("reason", "TOOL_EXECUTION_ERROR");
            errObj.addProperty("detail", "Tool execution error: " + e.getMessage());
            errObj.addProperty("suggestion", "Check the tool parameters and bot state");
            error.add("error", errObj);
            error.addProperty("duration_ms", duration);
            respond.accept(request.id(), error);
            return;
        }

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

        JsonObject response = buildToolResponse(result, duration);

        respond.accept(request.id(), response);
        LOG.info("Tool '{}' completed in {}ms: success={}", toolName, duration, result.success());
    }

    /**
     * 构建工具调用响应 JSON。
     * <p>
     * 成功时：
     * <pre>{ "success": true, "data": { "message": "...", ... }, "duration_ms": N }</pre>
     * 失败时：
     * <pre>{ "success": false, "error": { "reason": "...", "detail": "...", "suggestion": "..." }, "duration_ms": N }</pre>
     */
    private static JsonObject buildToolResponse(ToolResult result, long durationMs) {
        JsonObject response = new JsonObject();
        response.addProperty("success", result.success());
        response.addProperty("duration_ms", durationMs);

        if (result.success()) {
            // 成功：data 字段
            JsonObject dataObj = new JsonObject();
            if (result.message() != null && !result.message().isEmpty()) {
                dataObj.addProperty("message", result.message());
            }
            if (result.data() != null && !result.data().isEmpty()) {
                JsonElement dataJson = ARGS_GSON.toJsonTree(result.data());
                if (dataJson.isJsonObject()) {
                    for (var entry : dataJson.getAsJsonObject().entrySet()) {
                        dataObj.add(entry.getKey(), entry.getValue());
                    }
                } else {
                    dataObj.add("data", dataJson);
                }
            }
            response.add("data", dataObj);
        } else {
            // 失败：error 对象
            JsonObject errorObj = new JsonObject();
            errorObj.addProperty("reason",
                    result.errorCode() != null ? result.errorCode() : "UNKNOWN_ERROR");
            errorObj.addProperty("detail",
                    result.errorMessage() != null ? result.errorMessage()
                            : (result.message() != null ? result.message() : "Unknown error"));
            if (result.errorDetails() != null && !result.errorDetails().isEmpty()) {
                JsonElement detailsJson = ARGS_GSON.toJsonTree(result.errorDetails());
                if (detailsJson.isJsonObject()) {
                    errorObj.add("details", detailsJson.getAsJsonObject());
                }
            }
            response.add("error", errorObj);
        }

        return response;
    }

    // ---- 世界在线通知 ---- //

    /** 握手成功后通知 Agent Core 世界上线。 */
    private void sendWorldOnline() {
        JsonObject params = new JsonObject();
        params.addProperty("instance_id", identity.instanceId());
        params.addProperty("world_name", identity.worldName());
        params.addProperty("bot_count", botManager.onlineCount());
        params.addProperty("uptime_seconds", 0);
        tcpClient.sendNotification("world_online", params);
        LOG.info("Sent world_online: world='{}', bots={}", identity.worldName(), botManager.onlineCount());
    }

    // ---- 假人控制（bot_control） ---- //

    /**
     * 处理 Agent Core 发来的假人控制请求。
     * <p>
     * 支持三种操作：
     * <ul>
     *   <li>{@code online} — 创建假人并上线</li>
     *   <li>{@code offline} — 假人下线（休眠）</li>
     *   <li>{@code status} — 查询假人状态</li>
     * </ul>
     */
    private void handleBotControl(JsonRpcMessage.Request request,
                                  TcpClient.BiConsumer<JsonRpcId, JsonElement> respond) {
        JsonObject params = request.params() != null
                ? request.params().getAsJsonObject()
                : new JsonObject();

        String action = params.has("action") ? params.get("action").getAsString() : "";
        String botName = params.has("bot_name") ? params.get("bot_name").getAsString() : "";

        JsonObject result = new JsonObject();

        try {
            switch (action) {
                case "online" -> {
                    if (botName.isEmpty()) {
                        result.addProperty("success", false);
                        result.addProperty("message", "bot_name is required");
                        break;
                    }
                    ServerLevel overworld = server.overworld();
                    Vec3 spawnPos = new Vec3(
                            overworld.getSharedSpawnPos().getX() + 0.5,
                            overworld.getSharedSpawnPos().getY(),
                            overworld.getSharedSpawnPos().getZ() + 0.5
                    );
                    botManager.spawn(botName, overworld, spawnPos);
                    result.addProperty("success", true);
                    result.addProperty("message", "Bot '" + botName + "' spawned");
                    result.addProperty("bot_name", botName);
                }
                case "offline" -> {
                    if (botName.isEmpty()) {
                        result.addProperty("success", false);
                        result.addProperty("message", "bot_name is required");
                        break;
                    }
                    EntityPlayerMPFake bot = botManager.findByName(botName);
                    if (bot != null) {
                        botManager.despawn(bot);
                        result.addProperty("success", true);
                        result.addProperty("message", "Bot '" + botName + "' despawned");
                    } else {
                        result.addProperty("success", false);
                        result.addProperty("message", "Bot '" + botName + "' not found or not online");
                    }
                    result.addProperty("bot_name", botName);
                }
                case "status" -> {
                    String target = botName.isEmpty() ? null : botName;
                    result.addProperty("success", true);
                    result.addProperty("online_count", botManager.onlineCount());
                    if (target != null) {
                        EntityPlayerMPFake bot = botManager.findByName(target);
                        if (bot != null) {
                            result.addProperty("online", true);
                            result.addProperty("health", bot.getHealth());
                            result.addProperty("max_health", bot.getMaxHealth());
                            result.addProperty("food", bot.getFoodData().getFoodLevel());
                            result.addProperty("x", bot.getX());
                            result.addProperty("y", bot.getY());
                            result.addProperty("z", bot.getZ());
                            result.addProperty("dimension", ((ServerLevel) bot.level()).dimension().location().toString());
                        } else {
                            result.addProperty("online", false);
                            result.addProperty("message", "Bot '" + botName + "' is offline");
                        }
                    } else {
                        // 返回所有假人状态摘要
                        JsonArray botsArray = new JsonArray();
                        for (EntityPlayerMPFake bot : botManager.findAll()) {
                            JsonObject b = new JsonObject();
                            b.addProperty("name", bot.getName().getString());
                            b.addProperty("uuid", bot.getUUID().toString());
                            b.addProperty("health", bot.getHealth());
                            b.addProperty("max_health", bot.getMaxHealth());
                            b.addProperty("x", bot.getX());
                            b.addProperty("z", bot.getZ());
                            botsArray.add(b);
                        }
                        result.add("bots", botsArray);
                    }
                }
                default -> {
                    result.addProperty("success", false);
                    result.addProperty("message", "Unknown action: " + action + " (supported: online, offline, status)");
                }
            }
        } catch (Exception e) {
            LOG.warn("Bot control failed: action={}, bot={}", action, botName, e);
            result.addProperty("success", false);
            result.addProperty("message", "Error: " + e.getMessage());
        }

        respond.accept(request.id(), result);
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

    // ---- 假人生命周期事件桥接 ---- //

    /**
     * 注册 BotEventDispatcher 监听器，将假人生命周期事件通过 EventDispatcher 推送到 Agent Core。
     * <p>
     * 在 {@link #initialize()} 中调用，确保在假人生成前注册监听器。
     */
    private void registerBotEventListeners() {
        // 假人生成 → 事件推送
        BotEventDispatcher.ON_SPAWN.add((name, uuid) -> {
            JsonObject data = new JsonObject();
            data.addProperty("bot_name", name);
            data.addProperty("bot_uuid", uuid.toString());
            eventDispatcher.dispatch("bot_spawn", "info", data);
        });

        // 假人下线 → 事件推送
        BotEventDispatcher.ON_DESPAWN.add((name, uuid) -> {
            JsonObject data = new JsonObject();
            data.addProperty("bot_name", name);
            data.addProperty("bot_uuid", uuid.toString());
            eventDispatcher.dispatch("bot_despawn", "info", data);
        });

        // 假人死亡 → 事件推送
        BotEventDispatcher.ON_DEATH.add((name, uuid, deathMessage) -> {
            JsonObject data = new JsonObject();
            data.addProperty("bot_name", name);
            data.addProperty("bot_uuid", uuid.toString());
            data.addProperty("death_message", deathMessage);
            eventDispatcher.dispatch("bot_death", "danger", data);
        });

        // 假人销毁 → 事件推送
        BotEventDispatcher.ON_DISMISS.add((name, uuid) -> {
            JsonObject data = new JsonObject();
            data.addProperty("bot_name", name);
            data.addProperty("bot_uuid", uuid.toString());
            eventDispatcher.dispatch("bot_dismiss", "warning", data);
        });

        // 假人重生 → 事件推送
        BotEventDispatcher.ON_RESPAWN.add((name, uuid) -> {
            JsonObject data = new JsonObject();
            data.addProperty("bot_name", name);
            data.addProperty("bot_uuid", uuid.toString());
            eventDispatcher.dispatch("bot_respawn", "info", data);
        });

        LOG.info("Bot event listeners registered for world '{}'", identity.worldName());
    }

    // ---- 游戏事件监听（玩家连接 + 健康度检测） ---- //

    /**
     * 注册玩家连接事件监听器。
     * <p>
     * 监听 {@link ServerPlayConnectionEvents#JOIN} 和 {@link ServerPlayConnectionEvents#DISCONNECT}，
     * 通过 {@link EventDispatcher} 推送到 Agent Core。
     */
    private void registerPlayerEventListeners() {
        // 玩家加入
        ServerPlayConnectionEvents.JOIN.register((handler, sender, server) -> {
            String playerName = handler.getPlayer().getName().getString();
            UUID playerUuid = handler.getPlayer().getUUID();
            JsonObject data = new JsonObject();
            data.addProperty("player_name", playerName);
            data.addProperty("player_uuid", playerUuid.toString());
            eventDispatcher.dispatch("player_join", "info", data);
        });

        // 玩家离开
        ServerPlayConnectionEvents.DISCONNECT.register((handler, server) -> {
            String playerName = handler.getPlayer().getName().getString();
            UUID playerUuid = handler.getPlayer().getUUID();
            JsonObject data = new JsonObject();
            data.addProperty("player_name", playerName);
            data.addProperty("player_uuid", playerUuid.toString());
            eventDispatcher.dispatch("player_leave", "info", data);
        });

        LOG.info("Player event listeners registered for world '{}'", identity.worldName());
    }

    /**
     * 每 tick 检查假人健康度，低于阈值时推送事件。
     * <p>
     * 检查项：
     * <ul>
     *   <li>血量低于 30% → {@code health_low}</li>
     *   <li>饥饿度低于 6 → {@code hunger_low}</li>
     * </ul>
     * 每 20 tick（1 秒）检查一次，避免过于频繁。
     */
    private int healthCheckCounter = 0;
    private static final int HEALTH_CHECK_INTERVAL = 20; // 每 20 tick 检查一次

    private void checkBotHealth() {
        healthCheckCounter++;
        if (healthCheckCounter < HEALTH_CHECK_INTERVAL) {
            return;
        }
        healthCheckCounter = 0;

        for (EntityPlayerMPFake bot : botManager.findAll()) {
            // 低血量检测（< 30%）
            float health = bot.getHealth();
            float maxHealth = bot.getMaxHealth();
            if (health > 0 && health / maxHealth < 0.3f) {
                eventDispatcher.onHealthLow(health, maxHealth);
            }

            // 低饥饿度检测（< 6）
            int food = bot.getFoodData().getFoodLevel();
            if (food < 6) {
                JsonObject data = new JsonObject();
                data.addProperty("food", food);
                data.addProperty("max_food", 20);
                eventDispatcher.dispatch("hunger_low", "warning", data);
            }
        }
    }

    // ---- 参数解析 ---- //

    /**
     * 将 JSON 参数节点解析为 Java Map。
     * <p>
     * 修复原 WorldContext.handleToolCall 中三元表达式两支相同导致参数丢失的 bug。
     * 支持：null / JsonObject / 其它 JsonElement（视为空参数）。
     * 数字保持为 Double，布尔为 Boolean，字符串为 String，对象为嵌套 Map，数组为 List。
     */
    @SuppressWarnings("unchecked")
    private static Map<String, Object> parseJsonArgs(JsonElement element) {
        if (element == null || element.isJsonNull()) {
            return Map.of();
        }
        if (!element.isJsonObject()) {
            LOG.warn("Expected JsonObject for tool parameters, got {}",
                    element.getClass().getSimpleName());
            return Map.of();
        }
        Map<String, Object> map = ARGS_GSON.fromJson(element, Map.class);
        return map != null ? map : Map.of();
    }

    // ---- 状态采集 ---- //

    private StatusData collectStatus() {
        List<EntityPlayerMPFake> bots = botManager.findAll();
        if (bots.isEmpty()) {
            return null;
        }

        // 取第一个假人上报（多假人时后续可扩展）
        EntityPlayerMPFake bot = bots.get(0);
        ServerLevel level = (ServerLevel) bot.level();

        // 采集装备数据
        ItemStack mainhand = bot.getMainHandItem();
        ItemStack offhand = bot.getOffhandItem();
        ItemStack helmet = bot.getInventory().armor.get(3);
        ItemStack chestplate = bot.getInventory().armor.get(2);
        ItemStack leggings = bot.getInventory().armor.get(1);
        ItemStack boots = bot.getInventory().armor.get(0);

        // 采集背包摘要
        List<StatusData.ItemEntry> items = new ArrayList<>();
        int usedSlots = 0;
        for (int i = 0; i < bot.getInventory().items.size(); i++) {
            ItemStack stack = bot.getInventory().items.get(i);
            if (!stack.isEmpty()) {
                usedSlots++;
                items.add(new StatusData.ItemEntry(
                        stack.getItem().getDescriptionId(), stack.getCount()));
            }
        }

        // 天气
        String weather = level.isThundering() ? "thunder"
                : level.isRaining() ? "rain" : "clear";

        return new StatusData(
                bot.getHealth(), bot.getMaxHealth(),
                bot.getFoodData().getFoodLevel(), 20, bot.getFoodData().getSaturationLevel(),
                bot.getAirSupply(), bot.getMaxAirSupply(),
                bot.getX(), bot.getY(), bot.getZ(),
                level.dimension().location().toString(),
                bot.getYRot(), bot.getXRot(),
                (int) bot.getArmorValue(), 0,
                !mainhand.isEmpty() ? mainhand.getHoverName().getString() : "air",
                !offhand.isEmpty() ? offhand.getHoverName().getString() : "air",
                !helmet.isEmpty() ? helmet.getHoverName().getString() : "air",
                !chestplate.isEmpty() ? chestplate.getHoverName().getString() : "air",
                !leggings.isEmpty() ? leggings.getHoverName().getString() : "air",
                !boots.isEmpty() ? boots.getHoverName().getString() : "air",
                usedSlots, bot.getInventory().items.size(),
                items, List.of(),
                level.getDayTime(), weather,
                switch (level.getDifficulty()) {
                    case PEACEFUL -> "peaceful";
                    case EASY -> "easy";
                    case NORMAL -> "normal";
                    case HARD -> "hard";
                },
                bot.gameMode.getGameModeForPlayer().getName()
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

    // ──────────────────────────────────────────────
    //  行为树生命周期
    // ──────────────────────────────────────────────

    /**
     * 初始化行为树系统。
     * <p>
     * 创建 TaskRunner 和 UserTaskChain，注册到 BotAccess。
     * 在 {@link #initialize()} 中调用，在 TCP 连接前完成。
     */
    private void initializeBehaviorTree() {
        taskRunner = new TaskRunner();
        userTaskChain = new UserTaskChain(taskRunner);
        BotAccess.setTaskRunner(taskRunner);
        BotAccess.setPathfindingService(new PathfindingServiceImpl());
        taskRunner.enable();
        LOG.info("Behavior tree initialized with UserTaskChain");
    }

    /**
     * 每 tick 驱动行为树执行。
     * <p>
     * 由 {@link ServerTickEvents#END_SERVER_TICK} 事件驱动。
     * 获取 Bot 实例并创建 BotHandle，传递给 TaskRunner 执行 tick。
     */
    private void tickBehaviorTree() {
        if (taskRunner != null && taskRunner.isActive()) {
            ServerPlayer bot = BotAccess.getBot();
            if (bot != null) {
                BotHandle handle = BotAccess.createBotHandle(bot);
                if (handle != null) {
                    taskRunner.tick(handle);
                }
            }
        }
    }

    @Override
    public String toString() {
        return "WorldContext{world='" + identity.worldName()
                + "', instance=" + identity.instanceId()
                + ", uptime=" + getUptimeMs() + "ms}";
    }
}
