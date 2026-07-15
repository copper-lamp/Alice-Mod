package io.alice.mod.adapter.entry;

import io.alice.mod.adapter.config.AlicePaths;
import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;

/**
 * JSON 入口文件生成器。
 * <p>
 * 在模组首次启动时生成 {@code mcagent_instance.json}，
 * 描述实例的连接信息、认证令牌和数据库路径。
 * <p>
 * 文件位置：{@code Alice/mcagent_instance.json}
 */
public final class InstanceFileGenerator {

    private static final Logger LOG = LoggerFactory.getLogger(InstanceFileGenerator.class);

    private static final Gson GSON = new GsonBuilder()
            .disableHtmlEscaping()
            .setPrettyPrinting()
            .create();

    private static final String SCHEMA_VERSION = "1.0.0";

    private InstanceFileGenerator() {}

    /**
     * 生成或更新入口文件。
     *
     * @param gameDir    游戏根目录（Minecraft 运行目录）
     * @param instanceId 实例 UUID
     * @param authToken  认证令牌
     * @param online     是否已连接
     * @param worldName  当前世界名
     * @param host       Agent Core 地址
     * @param port       Agent Core 端口
     * @param edition    游戏版本类型（"java"）
     * @param version    游戏版本号
     */
    public static void generate(String gameDir, String instanceId, String authToken,
                                 boolean online, String worldName,
                                 String host, int port,
                                 String edition, String version) {
        try {
            Path gameDirPath = Path.of(gameDir);
            Path aliceDir = AlicePaths.aliceDir(gameDirPath);
            Files.createDirectories(aliceDir);

            Path filePath = AlicePaths.instanceFile(gameDirPath);

            JsonObject root = new JsonObject();
            root.addProperty("schema_version", SCHEMA_VERSION);
            root.addProperty("instance_id", instanceId);
            root.addProperty("instance_name", "Alice Mod JE");

            // game_version
            JsonObject gameVersion = new JsonObject();
            gameVersion.addProperty("edition", edition);
            gameVersion.addProperty("version", version);
            root.add("game_version", gameVersion);

            root.addProperty("mod_version", "1.0.0");

            // status
            JsonObject status = new JsonObject();
            status.addProperty("online", online);
            status.addProperty("last_online", Instant.now().toString());
            status.addProperty("world_name", worldName);
            root.add("status", status);

            // tcp
            JsonObject tcp = new JsonObject();
            tcp.addProperty("host", host);
            tcp.addProperty("port", port);
            root.add("tcp", tcp);

            // auth
            JsonObject auth = new JsonObject();
            auth.addProperty("token", authToken);
            root.add("auth", auth);

            // database
            Path worldDbPath = AlicePaths.worldDbPath(gameDirPath, worldName);
            JsonObject database = new JsonObject();
            database.addProperty("sqlite_path", AlicePaths.worldDbPath(gameDirPath, worldName).toString());
            database.addProperty("config_path", AlicePaths.configFile(gameDirPath).toString());
            database.addProperty("log_path", AlicePaths.logsDir(gameDirPath).toString());
            root.add("database", database);

            // toolset_info
            JsonObject toolsetInfo = new JsonObject();
            toolsetInfo.addProperty("total_tools", 0);
            toolsetInfo.add("tool_categories", new JsonArray());
            root.add("toolset_info", toolsetInfo);

            String json = GSON.toJson(root);
            Files.writeString(filePath, json);

            LOG.info("Instance file generated: {}", filePath);
        } catch (IOException e) {
            LOG.error("Failed to generate instance file", e);
        }
    }

    /**
     * 更新入口文件中的 online 状态。
     *
     * @param gameDir   游戏根目录
     * @param online    是否在线
     * @param worldName 世界名（可为 null）
     */
    public static void updateOnlineStatus(String gameDir, boolean online, String worldName) {
        try {
            Path filePath = AlicePaths.instanceFile(Path.of(gameDir));
            if (!Files.exists(filePath)) {
                LOG.warn("Instance file not found, skipping status update");
                return;
            }

            String content = Files.readString(filePath);
            JsonObject root = GSON.fromJson(content, JsonObject.class);

            JsonObject status = root.getAsJsonObject("status");
            status.addProperty("online", online);
            status.addProperty("last_online", Instant.now().toString());
            if (worldName != null) {
                status.addProperty("world_name", worldName);
            }

            Files.writeString(filePath, GSON.toJson(root));
            LOG.debug("Instance file status updated: online={}", online);
        } catch (IOException e) {
            LOG.warn("Failed to update instance file status", e);
        }
    }
}
