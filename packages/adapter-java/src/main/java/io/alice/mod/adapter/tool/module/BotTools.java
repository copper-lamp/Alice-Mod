package io.alice.mod.adapter.tool.module;

import carpet.patches.EntityPlayerMPFake;
import io.alice.mod.adapter.bot.BotManager;
import io.alice.mod.adapter.bot.BotManager.BotInfo;
import io.alice.mod.adapter.tool.ToolResult;
import io.alice.mod.adapter.tool.annotation.ToolMethod;
import io.alice.mod.adapter.tool.annotation.ToolModule;
import io.alice.mod.adapter.tool.annotation.ToolParam;
import io.alice.mod.adapter.world.WorldContextManager;
import net.minecraft.core.BlockPos;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.level.Level;
import net.minecraft.world.phys.Vec3;

import java.util.*;

/**
 * 假人管理工具模块。
 * <p>
 * 提供假人创建、休眠、销毁、列表查询等工具。
 * 所有假人由 Agent Core 通过工具调用统一管理。
 */
@ToolModule(category = "management", description = "假人管理工具")
public enum BotTools {
    INSTANCE;

    // ---- bot_spawn ---- //

    @ToolMethod(
            name = "bot_spawn",
            description = "创建一个游戏内假人。假人是继承 ServerPlayer 的完整玩家实体，可执行所有游戏操作。同名假人幂等——已在线则返回在线实例，已注册但离线则唤醒。",
            parameters = {
                    @ToolParam(name = "name", type = "string",
                            description = "假人名称，仅限字母数字和下划线，最长 16 字符"),
                    @ToolParam(name = "x", type = "number", description = "生成位置 X 坐标"),
                    @ToolParam(name = "y", type = "number", description = "生成位置 Y 坐标"),
                    @ToolParam(name = "z", type = "number", description = "生成位置 Z 坐标"),
                    @ToolParam(name = "dimension", type = "string",
                            description = "生成维度: overworld/nether/end", required = false)
            }
    )
    public ToolResult botSpawn(Map<String, Object> params) {
        long start = System.currentTimeMillis();
        try {
            String name = getString(params, "name");
            double x = getDouble(params, "x");
            double y = getDouble(params, "y");
            double z = getDouble(params, "z");
            String dimension = getString(params, "dimension", "overworld");

            MinecraftServer server = io.alice.mod.adapter.ai.BotAccess.getServer();
            if (server == null) {
                return ToolResult.fail("INTERNAL_ERROR", "Server not ready", start);
            }

            ServerLevel level = getLevel(server, dimension);
            if (level == null) {
                return ToolResult.fail("INVALID_PARAMS", "Invalid dimension: " + dimension, start);
            }

            EntityPlayerMPFake bot = BotManager.spawn(server, name, level, new Vec3(x, y, z));

            Map<String, Object> data = new LinkedHashMap<>();
            data.put("uuid", bot.getUUID().toString());
            data.put("name", bot.getName().getString());
            data.put("position", Map.of("x", bot.getX(), "y", bot.getY(), "z", bot.getZ()));
            data.put("dimension", ((ServerLevel) bot.level()).dimension().location().toString());

            return ToolResult.ok("Bot spawned: " + name, data, start);
        } catch (IllegalArgumentException e) {
            return ToolResult.fail("INVALID_PARAMS", e.getMessage(), start);
        } catch (Exception e) {
            return ToolResult.fail("INTERNAL_ERROR", "Failed to spawn bot: " + e.getMessage(), start);
        }
    }

    // ---- bot_despawn ---- //

    @ToolMethod(
            name = "bot_despawn",
            description = "休眠一个假人：保存存档后从游戏世界移除，不删除注册信息，可后续通过 bot_respawn 唤醒。",
            parameters = {
                    @ToolParam(name = "name", type = "string",
                            description = "假人名称或 UUID")
            }
    )
    public ToolResult botDespawn(Map<String, Object> params) {
        long start = System.currentTimeMillis();
        try {
            String nameOrUuid = getString(params, "name");

            EntityPlayerMPFake bot = resolveBot(nameOrUuid);
            if (bot == null) {
                return ToolResult.fail("NOT_FOUND", "Bot not found or not online: " + nameOrUuid, start);
            }

            String name = bot.getName().getString();
            String uuid = bot.getUUID().toString();
            BotManager.despawn(bot);

            Map<String, Object> data = new LinkedHashMap<>();
            data.put("uuid", uuid);
            data.put("name", name);

            return ToolResult.ok("Bot despawned: " + name, data, start);
        } catch (Exception e) {
            return ToolResult.fail("INTERNAL_ERROR", "Failed to despawn bot: " + e.getMessage(), start);
        }
    }

    // ---- bot_respawn ---- //

    @ToolMethod(
            name = "bot_respawn",
            description = "唤醒一个休眠的假人，将其恢复到游戏世界中。",
            parameters = {
                    @ToolParam(name = "name", type = "string",
                            description = "假人名称或 UUID"),
                    @ToolParam(name = "x", type = "number",
                            description = "目标 X 坐标（可选，默认使用注册表记录的位置）", required = false),
                    @ToolParam(name = "y", type = "number",
                            description = "目标 Y 坐标（可选）", required = false),
                    @ToolParam(name = "z", type = "number",
                            description = "目标 Z 坐标（可选）", required = false),
                    @ToolParam(name = "dimension", type = "string",
                            description = "维度（可选，默认使用注册表记录的维度）", required = false)
            }
    )
    public ToolResult botRespawn(Map<String, Object> params) {
        long start = System.currentTimeMillis();
        try {
            String nameOrUuid = getString(params, "name");
            MinecraftServer server = io.alice.mod.adapter.ai.BotAccess.getServer();
            if (server == null) {
                return ToolResult.fail("INTERNAL_ERROR", "Server not ready", start);
            }

            // 解析 UUID
            UUID uuid;
            try {
                uuid = UUID.fromString(nameOrUuid);
            } catch (IllegalArgumentException e) {
                // 可能是名称，通过注册表查找
                uuid = io.alice.mod.adapter.bot.BotRepository.get(server).findByName(nameOrUuid);
            }

            if (uuid == null) {
                return ToolResult.fail("NOT_FOUND", "Bot not found in registry: " + nameOrUuid, start);
            }

            // 解析位置和维度（可选）
            ServerLevel level = null;
            Vec3 pos = null;
            if (params.containsKey("dimension")) {
                level = getLevel(server, getString(params, "dimension"));
            }
            if (params.containsKey("x") && params.containsKey("y") && params.containsKey("z")) {
                pos = new Vec3(getDouble(params, "x"), getDouble(params, "y"), getDouble(params, "z"));
            }

            EntityPlayerMPFake bot = BotManager.respawn(server, uuid, level, pos);
            if (bot == null) {
                return ToolResult.fail("NOT_FOUND", "Bot not found in registry: " + nameOrUuid, start);
            }

            Map<String, Object> data = new LinkedHashMap<>();
            data.put("uuid", bot.getUUID().toString());
            data.put("name", bot.getName().getString());
            data.put("position", Map.of("x", bot.getX(), "y", bot.getY(), "z", bot.getZ()));
            data.put("dimension", ((ServerLevel) bot.level()).dimension().location().toString());

            return ToolResult.ok("Bot respawned: " + bot.getName().getString(), data, start);
        } catch (Exception e) {
            return ToolResult.fail("INTERNAL_ERROR", "Failed to respawn bot: " + e.getMessage(), start);
        }
    }

    // ---- bot_dismiss ---- //

    @ToolMethod(
            name = "bot_dismiss",
            description = "永久销毁一个假人：下线并删除注册信息，不可恢复。",
            parameters = {
                    @ToolParam(name = "name", type = "string",
                            description = "假人名称或 UUID")
            }
    )
    public ToolResult botDismiss(Map<String, Object> params) {
        long start = System.currentTimeMillis();
        try {
            String nameOrUuid = getString(params, "name");

            boolean result;
            String displayName;

            // 尝试 UUID 解析
            try {
                UUID uuid = UUID.fromString(nameOrUuid);
                result = BotManager.dismiss(uuid);
                displayName = nameOrUuid;
            } catch (IllegalArgumentException e) {
                // 按名称销毁
                result = BotManager.dismissByName(nameOrUuid);
                displayName = nameOrUuid;
            }

            if (!result) {
                return ToolResult.fail("NOT_FOUND", "Bot not found: " + nameOrUuid, start);
            }

            Map<String, Object> data = new LinkedHashMap<>();
            data.put("name", displayName);

            return ToolResult.ok("Bot dismissed: " + displayName, data, start);
        } catch (Exception e) {
            return ToolResult.fail("INTERNAL_ERROR", "Failed to dismiss bot: " + e.getMessage(), start);
        }
    }

    // ---- bot_list ---- //

    @ToolMethod(
            name = "bot_list",
            description = "列出所有已注册的假人，包括在线和离线状态。",
            parameters = {}
    )
    public ToolResult botList(Map<String, Object> params) {
        long start = System.currentTimeMillis();
        try {
            List<BotInfo> allBots = getBotManager().listAll();

            List<Map<String, Object>> botList = new ArrayList<>();
            for (BotInfo info : allBots) {
                Map<String, Object> entry = new LinkedHashMap<>();
                entry.put("uuid", info.uuid().toString());
                entry.put("name", info.name());
                entry.put("online", info.online());
                entry.put("dimension", info.dimension() != null ? info.dimension().toString() : "unknown");
                entry.put("position", Map.of(
                        "x", info.position().getX(),
                        "y", info.position().getY(),
                        "z", info.position().getZ()
                ));
                if (info.online()) {
                    entry.put("health", info.health());
                    entry.put("max_health", info.maxHealth());
                }
                entry.put("created_at", info.createdAt());
                botList.add(entry);
            }

            Map<String, Object> data = new LinkedHashMap<>();
            data.put("total", allBots.size());
            data.put("online", getBotManager().onlineCount());
            data.put("offline", allBots.size() - getBotManager().onlineCount());
            data.put("bots", botList);

            return ToolResult.ok("Found " + allBots.size() + " bots", data, start);
        } catch (Exception e) {
            return ToolResult.fail("INTERNAL_ERROR", "Failed to list bots: " + e.getMessage(), start);
        }
    }

    // ---- bot_info ---- //

    @ToolMethod(
            name = "bot_info",
            description = "查询假人的详细信息，包括在线状态、位置、维度、血量等。",
            parameters = {
                    @ToolParam(name = "name", type = "string",
                            description = "假人名称或 UUID")
            }
    )
    public ToolResult botInfo(Map<String, Object> params) {
        long start = System.currentTimeMillis();
        try {
            String nameOrUuid = getString(params, "name");
            EntityPlayerMPFake bot = resolveBot(nameOrUuid);

            if (bot == null) {
                // 检查注册表
                MinecraftServer server = io.alice.mod.adapter.ai.BotAccess.getServer();
                if (server != null) {
                    UUID uuid = null;
                    try {
                        uuid = UUID.fromString(nameOrUuid);
                    } catch (IllegalArgumentException ignored) {}

                    if (uuid == null) {
                        uuid = io.alice.mod.adapter.bot.BotRepository.get(server).findByName(nameOrUuid);
                    }

                    if (uuid != null) {
                        io.alice.mod.adapter.bot.BotRepository.Entry entry =
                                io.alice.mod.adapter.bot.BotRepository.get(server).find(uuid);
                        if (entry != null) {
                            Map<String, Object> data = new LinkedHashMap<>();
                            data.put("uuid", uuid.toString());
                            data.put("name", entry.name());
                            data.put("online", false);
                            data.put("dimension", entry.dimension());
                            data.put("position", Map.of("x", entry.x(), "y", entry.y(), "z", entry.z()));
                            data.put("created_at", entry.createdAt());
                            return ToolResult.ok("Bot info (offline): " + entry.name(), data, start);
                        }
                    }
                }
                return ToolResult.fail("NOT_FOUND", "Bot not found: " + nameOrUuid, start);
            }

            ServerLevel level = (ServerLevel) bot.level();
            Map<String, Object> data = new LinkedHashMap<>();
            data.put("uuid", bot.getUUID().toString());
            data.put("name", bot.getName().getString());
            data.put("online", true);
            data.put("dimension", level.dimension().location().toString());
            data.put("position", Map.of("x", bot.getX(), "y", bot.getY(), "z", bot.getZ()));
            data.put("health", bot.getHealth());
            data.put("max_health", bot.getMaxHealth());
            data.put("food_level", bot.getFoodData().getFoodLevel());
            data.put("experience_level", bot.experienceLevel);
            data.put("game_mode", bot.gameMode.getGameModeForPlayer().getName());
            data.put("created_at", getBotManager().getCreatedAt(bot.getUUID()));

            return ToolResult.ok("Bot info: " + bot.getName().getString(), data, start);
        } catch (Exception e) {
            return ToolResult.fail("INTERNAL_ERROR", "Failed to get bot info: " + e.getMessage(), start);
        }
    }

    // ---- 辅助方法 ---- //

    private static BotManager getBotManager() {
        return WorldContextManager.getActive().getBotManager();
    }

    private static String getString(Map<String, Object> params, String key) {
        Object v = params.get(key);
        return v != null ? v.toString() : "";
    }

    private static String getString(Map<String, Object> params, String key, String defaultValue) {
        Object v = params.get(key);
        return v != null ? v.toString() : defaultValue;
    }

    private static double getDouble(Map<String, Object> params, String key) {
        Object v = params.get(key);
        if (v instanceof Number n) return n.doubleValue();
        if (v instanceof String s) return Double.parseDouble(s);
        return 0;
    }

    private static ServerLevel getLevel(MinecraftServer server, String dimension) {
        return switch (dimension.toLowerCase()) {
            case "overworld", "minecraft:overworld" -> server.overworld();
            case "nether", "minecraft:the_nether" -> server.getLevel(Level.NETHER);
            case "end", "minecraft:the_end" -> server.getLevel(Level.END);
            default -> {
                ResourceLocation dimId = ResourceLocation.tryParse(dimension);
                if (dimId != null) {
                    yield server.getLevel(
                            net.minecraft.resources.ResourceKey.create(
                                    net.minecraft.core.registries.Registries.DIMENSION, dimId));
                }
                yield null;
            }
        };
    }

    /** 通过名称或 UUID 解析在线假人。 */
    private static EntityPlayerMPFake resolveBot(String nameOrUuid) {
        BotManager mgr = getBotManager();
        // 先尝试 UUID
        try {
            UUID uuid = UUID.fromString(nameOrUuid);
            EntityPlayerMPFake bot = mgr.get(uuid);
            if (bot != null) return bot;
        } catch (IllegalArgumentException ignored) {}

        // 再尝试名称
        return mgr.findByName(nameOrUuid);
    }
}