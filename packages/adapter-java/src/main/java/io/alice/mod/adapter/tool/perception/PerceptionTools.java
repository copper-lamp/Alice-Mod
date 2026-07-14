package io.alice.mod.adapter.tool.perception;

import io.alice.mod.adapter.ai.perception.PerceptionController;
import io.alice.mod.adapter.tool.ToolResult;
import io.alice.mod.adapter.tool.annotation.ToolMethod;
import io.alice.mod.adapter.tool.annotation.ToolModule;
import io.alice.mod.adapter.tool.annotation.ToolParam;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 感知工具模块——提供环境感知能力。
 */
@ToolModule(category = "perception", description = "感知类工具")
public enum PerceptionTools {
    INSTANCE;

    @ToolMethod(
            name = "look_around",
            description = "查看附近实体和方块（生物、玩家、掉落物、方块）",
            parameters = {
                    @ToolParam(name = "radius", type = "number",
                            description = "搜索半径（格），最大 64", required = false),
                    @ToolParam(name = "filter", type = "object",
                            description = "筛选条件: {hostile, passive, player, item, block}", required = false)
            }
    )
    public ToolResult lookAround(Map<String, Object> params) {
        long start = System.currentTimeMillis();
        try {
            int radius = params.containsKey("radius")
                    ? ((Number) params.get("radius")).intValue()
                    : 16;
            radius = Math.min(radius, 64);

            @SuppressWarnings("unchecked")
            Map<String, Object> filter = (Map<String, Object>) params.get("filter");

            var result = PerceptionController.scanNearby(radius, filter);
            return ToolResult.ok(result.message(), result.data(), start);
        } catch (Exception e) {
            return ToolResult.fail("INTERNAL_ERROR", e.getMessage(), start);
        }
    }

    @ToolMethod(
            name = "look_at_block",
            description = "查看指定坐标的方块详情",
            parameters = {
                    @ToolParam(name = "x", type = "number", description = "方块 X 坐标"),
                    @ToolParam(name = "y", type = "number", description = "方块 Y 坐标"),
                    @ToolParam(name = "z", type = "number", description = "方块 Z 坐标")
            }
    )
    public ToolResult lookAtBlock(Map<String, Object> params) {
        long start = System.currentTimeMillis();
        try {
            int x = ((Number) params.get("x")).intValue();
            int y = ((Number) params.get("y")).intValue();
            int z = ((Number) params.get("z")).intValue();

            var info = PerceptionController.getBlockInfo(x, y, z);
            if (info == null) {
                return ToolResult.fail("BLOCK_NOT_FOUND", "方块不存在或 Bot 未找到", start);
            }

            Map<String, Object> data = new HashMap<>();
            data.put("name", info.name());
            data.put("displayName", info.displayName());
            data.put("position", Map.of("x", info.position().x(), "y", info.position().y(), "z", info.position().z()));
            data.put("isSolid", info.isSolid());
            data.put("isLiquid", info.isLiquid());
            data.put("isAir", info.isAir());
            data.put("hasBlockEntity", info.hasBlockEntity());

            String message = String.format("方块 (%d,%d,%d): %s (%s, %s)",
                    x, y, z, info.displayName(),
                    info.isSolid() ? "固体" : "非固体",
                    info.hasBlockEntity() ? "有方块实体" : "无方块实体");

            return ToolResult.ok(message, data, start);
        } catch (Exception e) {
            return ToolResult.fail("INTERNAL_ERROR", e.getMessage(), start);
        }
    }

    @ToolMethod(
            name = "look_in_container",
            description = "查看容器（箱子、熔炉等）的内容",
            parameters = {
                    @ToolParam(name = "x", type = "number", description = "容器方块 X 坐标"),
                    @ToolParam(name = "y", type = "number", description = "容器方块 Y 坐标"),
                    @ToolParam(name = "z", type = "number", description = "容器方块 Z 坐标")
            }
    )
    public ToolResult lookInContainer(Map<String, Object> params) {
        long start = System.currentTimeMillis();
        try {
            int x = ((Number) params.get("x")).intValue();
            int y = ((Number) params.get("y")).intValue();
            int z = ((Number) params.get("z")).intValue();

            var info = PerceptionController.getContainerContents(x, y, z);
            if (info == null) {
                return ToolResult.fail("CONTAINER_NOT_FOUND", "不是容器或 Bot 未找到", start);
            }

            Map<String, Object> data = new HashMap<>();
            data.put("containerType", info.containerType());
            data.put("position", Map.of("x", info.position().x(), "y", info.position().y(), "z", info.position().z()));
            data.put("totalSlots", info.totalSlots());
            data.put("usedSlots", info.usedSlots());
            data.put("items", info.items());

            String message = String.format("%s (%d,%d,%d) %d/%d",
                    info.containerType(), x, y, z, info.usedSlots(), info.totalSlots());

            return ToolResult.ok(message, data, start);
        } catch (Exception e) {
            return ToolResult.fail("INTERNAL_ERROR", e.getMessage(), start);
        }
    }

    @ToolMethod(
            name = "look_time_weather",
            description = "查看世界时间和天气",
            parameters = {}
    )
    public ToolResult lookTimeWeather(Map<String, Object> params) {
        long start = System.currentTimeMillis();
        try {
            var info = PerceptionController.getWorldTime();
            if (info == null) {
                return ToolResult.fail("BOT_NOT_FOUND", "Bot 未找到", start);
            }

            Map<String, Object> data = new HashMap<>();
            data.put("worldTime", info.worldTime());
            data.put("dayTime", info.dayTime());
            data.put("isDay", info.isDay());
            data.put("weather", info.weather());
            data.put("difficulty", info.difficulty());

            String weatherZh = switch (info.weather()) {
                case "clear" -> "晴";
                case "rain" -> "雨";
                case "thunder" -> "雷暴";
                default -> info.weather();
            };

            String message = String.format("时间: %s (%d/24000) 天气: %s 难度: %s",
                    info.isDay() ? "白天" : "夜晚",
                    info.dayTime(),
                    weatherZh,
                    info.difficulty());

            return ToolResult.ok(message, data, start);
        } catch (Exception e) {
            return ToolResult.fail("INTERNAL_ERROR", e.getMessage(), start);
        }
    }

    @ToolMethod(
            name = "look_online_players",
            description = "查看在线玩家列表",
            parameters = {}
    )
    public ToolResult lookOnlinePlayers(Map<String, Object> params) {
        long start = System.currentTimeMillis();
        try {
            var players = PerceptionController.getOnlinePlayers();

            List<Map<String, Object>> playerList = players.stream()
                    .map(p -> {
                        Map<String, Object> map = new HashMap<>();
                        map.put("name", p.name());
                        map.put("uuid", p.uuid());
                        map.put("position", Map.of("x", p.position().x(), "y", p.position().y(), "z", p.position().z()));
                        map.put("dimension", p.dimension());
                        map.put("distance", p.distance());
                        return map;
                    })
                    .toList();

            Map<String, Object> data = new HashMap<>();
            data.put("players", playerList);
            data.put("total", players.size());

            StringBuilder sb = new StringBuilder();
            sb.append("在线玩家 (").append(players.size()).append("个):\n");
            for (var p : players) {
                sb.append("  - ").append(p.name())
                        .append(" ").append(String.format("%.1f", p.distance())).append("格")
                        .append(" 位置(").append((int) p.position().x()).append(",")
                        .append((int) p.position().y()).append(",")
                        .append((int) p.position().z()).append(")")
                        .append(" ").append(p.dimension())
                        .append("\n");
            }

            return ToolResult.ok(sb.toString(), data, start);
        } catch (Exception e) {
            return ToolResult.fail("INTERNAL_ERROR", e.getMessage(), start);
        }
    }
}
