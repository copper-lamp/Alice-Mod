package io.alice.mod.adapter.ai.perception;

import io.alice.mod.adapter.ai.BotAccess;
import net.minecraft.core.BlockPos;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.Mob;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.entity.item.ItemEntity;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.phys.AABB;
import net.minecraft.world.phys.Vec3;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.*;

/**
 * 感知 AI 控制器——提供环境感知能力。
 */
public final class PerceptionController {

    private static final Logger LOG = LoggerFactory.getLogger(PerceptionController.class);

    private PerceptionController() {}

    /**
     * 扫描附近实体和方块。
     */
    public static ScanResult scanNearby(int radius, Map<String, Object> filter) {
        ServerPlayer bot = BotAccess.getBot();
        if (bot == null) {
            return new ScanResult("Bot 未找到", Map.of());
        }

        ServerLevel level = (ServerLevel) bot.level();
        Vec3 pos = bot.position();
        AABB area = AABB.ofSize(pos, radius * 2, radius * 2, radius * 2);

        List<EntityInfo> entities = new ArrayList<>();
        boolean filterHostile = getBool(filter, "hostile");
        boolean filterPassive = getBool(filter, "passive");
        boolean filterPlayer = getBool(filter, "player");
        boolean filterItem = getBool(filter, "item");
        boolean noEntityFilter = !filterHostile && !filterPassive && !filterPlayer && !filterItem;

        // 扫描实体
        for (Entity entity : level.getEntities(null, area)) {
            if (entity == bot) continue;

            double distance = entity.distanceTo(bot);
            if (distance > radius || distance < 0.5) continue;

            boolean isHostile = entity instanceof Mob mob && mob.isAggressive();
            boolean isPlayer = entity instanceof Player;
            boolean isItem = entity instanceof ItemEntity;

            if (!noEntityFilter) {
                if (filterHostile && !isHostile) continue;
                if (filterPassive && isHostile) continue;
                if (filterPlayer && !isPlayer) continue;
                if (filterItem && !isItem) continue;
            }

            EntityInfo info = new EntityInfo(
                    entity.getStringUUID(),
                    entity.getType().getDescriptionId(),
                    entity.getName().getString(),
                    distance,
                    new Position(entity.getX(), entity.getY(), entity.getZ()),
                    entity instanceof LivingEntity le ? (float) le.getHealth() : 0,
                    entity instanceof LivingEntity le ? (float) le.getMaxHealth() : 0,
                    isHostile,
                    isPlayer,
                    isItem,
                    isItem ? getItemStackInfo((ItemEntity) entity) : null
            );
            entities.add(info);
        }

        // 按距离排序，最多 50 个
        entities.sort(Comparator.comparingDouble(e -> e.distance()));
        if (entities.size() > 50) {
            entities = entities.subList(0, 50);
        }

        String message = formatNearbyMessage(entities, radius);
        Map<String, Object> data = new HashMap<>();
        data.put("entities", entities);
        data.put("total", entities.size());

        return new ScanResult(message, data);
    }

    /**
     * 查看指定坐标的方块。
     */
    public static BlockInfo getBlockInfo(int x, int y, int z) {
        ServerPlayer bot = BotAccess.getBot();
        if (bot == null) return null;

        ServerLevel level = (ServerLevel) bot.level();
        BlockPos pos = new BlockPos(x, y, z);
        BlockState state = level.getBlockState(pos);
        Block block = state.getBlock();

        boolean hasBlockEntity = level.getBlockEntity(pos) != null;

        return new BlockInfo(
                block.getName().getString(),
                Component.translatable(block.getDescriptionId()).getString(),
                new Position(x, y, z),
                !state.canBeReplaced(),
                state.liquid(),
                state.isAir(),
                hasBlockEntity
        );
    }

    /**
     * 查看容器内容。
     */
    public static ContainerInfo getContainerContents(int x, int y, int z) {
        ServerPlayer bot = BotAccess.getBot();
        if (bot == null) return null;

        ServerLevel level = (ServerLevel) bot.level();
        BlockPos pos = new BlockPos(x, y, z);
        BlockEntity blockEntity = level.getBlockEntity(pos);

        if (blockEntity == null) {
            return null;
        }

        // TODO: 实现容器内容读取（需要访问 Container 接口）
        // 当前返回基本信息
        return new ContainerInfo(
                level.getBlockState(pos).getBlock().getName().getString(),
                new Position(x, y, z),
                27, // 默认箱子大小
                0,
                List.of()
        );
    }

    /**
     * 获取世界时间和天气。
     */
    public static WorldTimeInfo getWorldTime() {
        ServerPlayer bot = BotAccess.getBot();
        if (bot == null) return null;

        ServerLevel level = (ServerLevel) bot.level();
        long dayTime = level.getDayTime() % 24000;
        boolean isDay = dayTime < 12000;

        String weather = "clear";
        if (level.isThundering()) {
            weather = "thunder";
        } else if (level.isRaining()) {
            weather = "rain";
        }

        String difficulty = switch (level.getDifficulty()) {
            case PEACEFUL -> "peaceful";
            case EASY -> "easy";
            case NORMAL -> "normal";
            case HARD -> "hard";
        };

        return new WorldTimeInfo(
                level.getDayTime(),
                dayTime,
                isDay,
                weather,
                difficulty
        );
    }

    /**
     * 获取在线玩家列表。
     */
    public static List<PlayerInfo> getOnlinePlayers() {
        ServerPlayer bot = BotAccess.getBot();
        if (bot == null) return List.of();

        List<ServerPlayer> players = BotAccess.getOnlinePlayers();
        List<PlayerInfo> result = new ArrayList<>();

        for (ServerPlayer player : players) {
            if (player == bot) continue;

            result.add(new PlayerInfo(
                    player.getScoreboardName(),
                    player.getStringUUID(),
                    new Position(player.getX(), player.getY(), player.getZ()),
                    player.level().dimension().location().toString(),
                    player.distanceTo(bot)
            ));
        }

        return result;
    }

    // ---- 辅助方法 ----

    private static Map<String, Object> getItemStackInfo(ItemEntity entity) {
        var stack = entity.getItem();
        if (stack.isEmpty()) return null;

        Map<String, Object> info = new HashMap<>();
        info.put("name", stack.getHoverName().getString());
        info.put("count", stack.getCount());
        return info;
    }

    private static boolean getBool(Map<String, Object> map, String key) {
        return map != null && Boolean.TRUE.equals(map.get(key));
    }

    private static String formatNearbyMessage(List<EntityInfo> entities, int radius) {
        if (entities.isEmpty()) return "附近没有实体";

        StringBuilder sb = new StringBuilder();
        sb.append("附近环境 (").append(radius).append("格内, 共").append(entities.size()).append("个):\n");
        for (var e : entities) {
            sb.append("  - ").append(e.name());
            if (e.hostile()) sb.append(" (敌对)");
            if (e.isPlayer()) sb.append(" (玩家)");
            if (e.isItem() && e.itemStack() != null) {
                sb.append(" ").append(e.itemStack().get("name")).append("x").append(e.itemStack().get("count"));
            }
            sb.append(" ").append(String.format("%.1f", e.distance())).append("格");
            if (e.health() > 0) {
                sb.append(" 血量 ").append((int) e.health()).append("/").append((int) e.maxHealth());
            }
            sb.append("\n");
        }
        return sb.toString();
    }

    // ---- 数据记录 ----

    public record ScanResult(String message, Map<String, Object> data) {}

    public record Position(double x, double y, double z) {}

    public record EntityInfo(
            String id, String type, String name,
            double distance, Position position,
            float health, float maxHealth,
            boolean hostile, boolean isPlayer, boolean isItem,
            Map<String, Object> itemStack
    ) {}

    public record BlockInfo(
            String name, String displayName, Position position,
            boolean isSolid, boolean isLiquid, boolean isAir,
            boolean hasBlockEntity
    ) {}

    public record ContainerInfo(
            String containerType, Position position,
            int totalSlots, int usedSlots,
            List<Map<String, Object>> items
    ) {}

    public record WorldTimeInfo(
            long worldTime, long dayTime, boolean isDay,
            String weather, String difficulty
    ) {}

    public record PlayerInfo(
            String name, String uuid, Position position,
            String dimension, double distance
    ) {}
}
