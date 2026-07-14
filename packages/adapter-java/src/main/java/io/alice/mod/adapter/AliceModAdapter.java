package io.alice.mod.adapter;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import io.alice.mod.adapter.bot.BotManager;
import io.alice.mod.adapter.entry.InstanceFileGenerator;
import io.alice.mod.adapter.status.EventDispatcher;
import io.alice.mod.adapter.status.StatusCollector;
import io.alice.mod.adapter.status.StatusData;
import io.alice.mod.adapter.tcp.HandshakeManager.HandshakeResult;
import io.alice.mod.adapter.tcp.JsonRpcId;
import io.alice.mod.adapter.tcp.JsonRpcMessage;
import io.alice.mod.adapter.tcp.TcpClient;
import io.alice.mod.adapter.tcp.TcpClient.Callbacks;
import io.alice.mod.adapter.tcp.TcpClient.ClientConfig;
import io.alice.mod.adapter.api.AliceToolPlugin;
import io.alice.mod.adapter.tool.AliceTool;
import io.alice.mod.adapter.tool.SchemaGenerator;
import io.alice.mod.adapter.tool.ServiceAccessImpl;
import io.alice.mod.adapter.tool.ToolPluginDiscoverer;
import io.alice.mod.adapter.tool.ToolRegistrarImpl;
import io.alice.mod.adapter.tool.ToolRegistry;
import io.alice.mod.adapter.tool.ToolResult;
import io.alice.mod.adapter.tool.ToolScanner;
import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerLifecycleEvents;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerTickEvents;
import net.fabricmc.loader.api.FabricLoader;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.Map;
import java.util.UUID;

public class AliceModAdapter implements ModInitializer {

    public static final Logger LOGGER = LoggerFactory.getLogger("alice-mod");

    // ---- 实例身份（首次启动时生成，持久化存储） ----

    private String instanceId;
    private String authToken;

    // ---- TCP 客户端 ----

    private TcpClient tcpClient;

    // ---- V3 新增组件 ----

    private StatusCollector statusCollector;
    private EventDispatcher eventDispatcher;

    @Override
    public void onInitialize() {
        LOGGER.info("Alice Mod Adapter JE initializing...");

        // 初始化 BotAccess（获取 MinecraftServer 实例）
        io.alice.mod.adapter.ai.BotAccess.init();

        // 注册服务端生命周期事件（BotManager 集成）
        ServerLifecycleEvents.SERVER_STARTED.register(server -> {
            BotManager.onServerStarted(server);
            LOGGER.info("BotManager: server started, recovered {} bot entries", 
                    io.alice.mod.adapter.bot.BotRepository.get(server).size());
        });

        ServerLifecycleEvents.SERVER_STOPPING.register(server -> {
            BotManager.onServerStopped();
        });

        // 注册服务端 tick 事件（假人重生检查）
        ServerTickEvents.END_SERVER_TICK.register(server -> {
            BotManager.tick();
        });

        // 初始化实例身份
        this.instanceId = UUID.randomUUID().toString();
        this.authToken = "mct_" + UUID.randomUUID().toString().replace("-", "").substring(0, 24);

        // 生成 JSON 入口文件
        String gameDir = FabricLoader.getInstance().getGameDir().toString();
        InstanceFileGenerator.generate(
                gameDir, instanceId, authToken,
                false, "world",
                TcpClient.DEFAULT_HOST, TcpClient.DEFAULT_PORT,
                "java", "1.21.4"
        );

        // 扫描并注册内建工具（扫描所有工具子包）
        ToolScanner.scanAndRegister("io.alice.mod.adapter.tool");
        int builtinCount = ToolRegistry.size();
        LOGGER.info("Built-in tools registered: {}", builtinCount);

        // 发现并注册附属模组插件工具
        ServiceAccessImpl serviceAccess = new ServiceAccessImpl();
        ToolPluginDiscoverer.discover().forEach(plugin -> {
            ToolRegistrarImpl registrar = new ToolRegistrarImpl();
            try {
                plugin.registerTools(registrar, serviceAccess);
                registrar.deactivate();
                LOGGER.info("Plugin initialized: {}", plugin.getClass().getName());
            } catch (Exception e) {
                LOGGER.error("Plugin '{}' failed during registration: {}",
                        plugin.getClass().getName(), e.getMessage(), e);
            }
        });

        LOGGER.info("Total tools registered: {} (builtin={}, plugin={})",
                ToolRegistry.size(), builtinCount, ToolRegistry.size() - builtinCount);

        // 创建事件分发器
        eventDispatcher = new EventDispatcher(eventJson -> {
            tcpClient.sendNotification("event", eventJson);
        });

        // 创建状态采集器（使用临时假数据，后续版本接入真实游戏状态）
        statusCollector = new StatusCollector(
                this::collectStatus,
                statusData -> {
                    JsonObject params = statusData.toJson();
                    tcpClient.sendNotification("status_report", params);
                }
        );

        // 启动 TCP 客户端
        startTcpClient();

        LOGGER.info("Alice Mod Adapter JE initialized successfully.");
    }

    // ---- TCP 客户端 ----

    private void startTcpClient() {
        ClientConfig config = new ClientConfig(
                TcpClient.DEFAULT_HOST,
                TcpClient.DEFAULT_PORT,
                instanceId,
                authToken,
                ClientConfig.DEFAULT_VERSION,
                ClientConfig.DEFAULT_MOD_NAME,
                true
        );

        tcpClient = new TcpClient(config, new Callbacks() {
            // 注册 TcpClient 实例供 TcpService 使用
            io.alice.mod.adapter.tool.service.TcpServiceImpl.setClient(tcpClient);

            @Override
            public void onToolCall(JsonRpcMessage.Request request,
                                   TcpClient.BiConsumer<JsonRpcId, JsonElement> respond) {
                handleToolCall(request, respond);
            }

            @Override
            public void onHandshakeSuccess(HandshakeResult result) {
                LOGGER.info("Handshake success: session={}, heartbeat={}s",
                        result.sessionId(), result.heartbeatInterval());

                // 注册工具到 Agent Core
                registerTools();

                // 启动状态上报
                statusCollector.start();

                // 更新入口文件状态
                InstanceFileGenerator.updateOnlineStatus(
                        FabricLoader.getInstance().getGameDir().toString(),
                        true, "world");
            }

            @Override
            public void onDisconnected() {
                LOGGER.warn("TCP connection lost");
                statusCollector.stop();
                InstanceFileGenerator.updateOnlineStatus(
                        FabricLoader.getInstance().getGameDir().toString(),
                        false, null);
            }

            @Override
            public void onReconnectFailed() {
                LOGGER.error("All reconnect attempts failed");
            }
        });

        tcpClient.addStateListener(state ->
                LOGGER.info("Connection state: {}", state));

        tcpClient.connect();
    }

    // ---- 工具注册 ----

    private void registerTools() {
        var tools = ToolRegistry.all();
        if (tools.isEmpty()) {
            LOGGER.warn("No tools registered, skipping registration");
            return;
        }

        JsonObject payload = SchemaGenerator.generateRegisterPayload(tools);
        LOGGER.info("Registering {} tools with Agent Core", tools.size());

        tcpClient.sendRequest("register_tools", payload)
                .thenAccept(result -> result.asResponse().ifPresentOrElse(
                        response -> {
                            JsonObject data = response.result().getAsJsonObject();
                            int count = data.get("registered_count").getAsInt();
                            LOGGER.info("Tools registered: {} (confirmed by Agent Core)", count);
                        },
                        () -> LOGGER.warn("register_tools response not received")
                ))
                .exceptionally(e -> {
                    LOGGER.error("Failed to register tools", e);
                    return null;
                });
    }

    // ---- 工具调用 ----

    private void handleToolCall(JsonRpcMessage.Request request,
                                TcpClient.BiConsumer<JsonRpcId, JsonElement> respond) {
        JsonObject params = request.params() != null
                ? request.params().getAsJsonObject()
                : new JsonObject();
        String toolName = params.has("tool_name")
                ? params.get("tool_name").getAsString()
                : "unknown";

        LOGGER.info("Tool call: tool={}, id={}, params={}", toolName, request.id(), params);

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
            error.addProperty("duration_ms", 0);
            respond.accept(request.id(), error);
            return;
        }

        long start = System.currentTimeMillis();
        ToolResult result = tool.invoke(args);
        long duration = System.currentTimeMillis() - start;

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
        LOGGER.info("Tool {} completed in {}ms: success={}", toolName, duration, result.success());
    }

    // ---- 状态采集（临时实现，后续版本接入真实游戏状态） ----

    private StatusData collectStatus() {
        return new StatusData(
                20.0, 20.0,
                20, 20, 5.0f,
                300, 300,
                0.0, 64.0, 0.0,
                "overworld",
                0.0f, 0.0f,
                0, 0,
                "air", "air",
                "air", "air", "air", "air",
                0, 36,
                java.util.List.of(),
                java.util.List.of(),
                6000,
                "clear",
                "normal",
                "survival"
        );
    }
}
