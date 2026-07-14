package io.alice.mod.adapter.world;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonObject;
import net.minecraft.server.MinecraftServer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.UUID;

/**
 * 世界身份 — 每个世界/服务器的唯一身份标识。
 * <p>
 * 每个 Minecraft 世界（存档）或专用服务器拥有独立的实例身份，
 * 存储在对应世界的 {@code config/mcagent/world_identity.json} 中。
 * 同一个世界每次加载使用相同的 instance_id，确保 Agent Core 可恢复会话上下文。
 */
public record WorldIdentity(
        String instanceId,
        String authToken,
        String worldName
) {

    private static final Logger LOG = LoggerFactory.getLogger(WorldIdentity.class);
    private static final Gson GSON = new GsonBuilder().setPrettyPrinting().disableHtmlEscaping().create();

    /**
     * 根据 MinecraftServer 实例获取对应的世界身份。
     * <p>
     * 专用服务器：身份文件存储在 {@code ./config/mcagent/world_identity.json}
     * 集成服务器：身份文件存储在存档目录的 {@code config/mcagent/world_identity.json}
     */
    public static WorldIdentity forServer(MinecraftServer server) {
        Path identityFile;
        String worldTag;

        if (server.isDedicatedServer()) {
            // 专用服务器
            identityFile = server.getServerDirectory()
                    .resolve("config/mcagent/world_identity.json")
                    .normalize();
            worldTag = "server_dedicated";
        } else {
            // 集成服务器（单人模式）
            String worldDirName = server.getWorldData().getLevelName();
            identityFile = server.getServerDirectory()
                    .resolve("saves")
                    .resolve(sanitizeWorldName(worldDirName))
                    .resolve("config/mcagent/world_identity.json")
                    .normalize();
            worldTag = worldDirName;
        }

        return loadOrCreate(identityFile, worldTag);
    }

    /**
     * 加载或创建世界身份文件。
     */
    private static WorldIdentity loadOrCreate(Path identityFile, String worldTag) {
        // 尝试加载已有身份
        if (Files.exists(identityFile)) {
            try {
                String content = Files.readString(identityFile);
                JsonObject root = GSON.fromJson(content, JsonObject.class);
                String instanceId = root.get("instance_id").getAsString();
                String authToken = root.get("auth_token").getAsString();
                String worldName = root.has("world_name")
                        ? root.get("world_name").getAsString()
                        : worldTag;

                WorldIdentity existing = new WorldIdentity(instanceId, authToken, worldName);
                LOG.info("Loaded world identity: instance={}, world={}", instanceId, worldName);
                return existing;
            } catch (Exception e) {
                LOG.warn("Failed to load world identity file, will create new: {}", e.getMessage());
            }
        }

        // 创建新身份
        String instanceId = UUID.nameUUIDFromBytes(
                ("alice_world_" + worldTag + "_" + System.currentTimeMillis()).getBytes()
        ).toString();
        String authToken = "mct_" + UUID.randomUUID().toString()
                .replace("-", "").substring(0, 24);
        WorldIdentity identity = new WorldIdentity(instanceId, authToken, worldTag);

        save(identityFile, identity);
        return identity;
    }

    /**
     * 持久化世界身份到文件。
     */
    private static void save(Path identityFile, WorldIdentity identity) {
        try {
            Files.createDirectories(identityFile.getParent());

            JsonObject root = new JsonObject();
            root.addProperty("instance_id", identity.instanceId());
            root.addProperty("auth_token", identity.authToken());
            root.addProperty("world_name", identity.worldName());
            root.addProperty("created_at", java.time.Instant.now().toString());

            Files.writeString(identityFile, GSON.toJson(root));
            LOG.info("Created world identity: instance={}, world={}, file={}",
                    identity.instanceId(), identity.worldName(), identityFile);
        } catch (IOException e) {
            LOG.error("Failed to save world identity file: {}", identityFile, e);
        }
    }

    /** 清理世界名中的非法文件名字符。 */
    private static String sanitizeWorldName(String name) {
        return name.replaceAll("[\\\\/:*?\"<>|]", "_");
    }
}
