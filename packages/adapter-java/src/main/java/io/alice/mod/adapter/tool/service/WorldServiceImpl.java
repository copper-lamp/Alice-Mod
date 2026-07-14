package io.alice.mod.adapter.tool.service;

import io.alice.mod.adapter.ai.BotAccess;
import io.alice.mod.adapter.api.service.WorldService;
import io.alice.mod.adapter.api.types.*;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.ResourceKey;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.phys.AABB;
import net.minecraft.world.phys.shapes.VoxelShape;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * {@link WorldService} 实现。
 * 桥接到 Minecraft ServerLevel / BlockState API。
 */
public class WorldServiceImpl implements WorldService {

    private static final Logger LOG = LoggerFactory.getLogger(WorldServiceImpl.class);

    @Override
    public String getBlockId(int x, int y, int z, String dimension) {
        ServerLevel level = getLevel(dimension);
        if (level == null) return "unknown";
        return BuiltInRegistries.BLOCK.getKey(level.getBlockState(new BlockPos(x, y, z)).getBlock()).toString();
    }

    @Override
    public Map<String, String> getBlockProperties(int x, int y, int z, String dimension) {
        ServerLevel level = getLevel(dimension);
        if (level == null) return Map.of();
        BlockState state = level.getBlockState(new BlockPos(x, y, z));
        Map<String, String> props = new LinkedHashMap<>();
        state.getValues().forEach((prop, value) ->
                props.put(prop.getName(), value.toString()));
        return props;
    }

    @Override
    public boolean isAir(int x, int y, int z, String dimension) {
        ServerLevel level = getLevel(dimension);
        if (level == null) return true;
        return level.getBlockState(new BlockPos(x, y, z)).isAir();
    }

    @Override
    public CollisionShape getCollisionShape(int x, int y, int z, String dimension) {
        ServerLevel level = getLevel(dimension);
        if (level == null) {
            return new CollisionShape(true, 0, 0, 0, 0, 0, 0);
        }
        BlockPos pos = new BlockPos(x, y, z);
        BlockState state = level.getBlockState(pos);
        if (state.isAir()) {
            return new CollisionShape(true, 0, 0, 0, 0, 0, 0);
        }
        VoxelShape shape = state.getCollisionShape(level, pos);
        if (shape.isEmpty()) {
            return new CollisionShape(true, 0, 0, 0, 0, 0, 0);
        }
        AABB bounds = shape.bounds();
        return new CollisionShape(false,
                bounds.minX, bounds.minY, bounds.minZ,
                bounds.maxX, bounds.maxY, bounds.maxZ);
    }

    @Override
    public List<EntityInfo> getNearbyEntities(Vec3 center, double radius, String dimension) {
        ServerLevel level = getLevel(dimension);
        if (level == null) return List.of();

        BlockPos centerPos = BlockPos.containing(center.x(), center.y(), center.z());
        AABB area = new AABB(centerPos).inflate(radius);
        List<EntityInfo> result = new ArrayList<>();

        for (Entity entity : level.getEntitiesOfClass(Entity.class, area)) {
            float health = 0;
            float maxHealth = 0;
            if (entity instanceof LivingEntity living) {
                health = living.getHealth();
                maxHealth = living.getMaxHealth();
            }
            result.add(new EntityInfo(
                    entity.getUUID(),
                    BuiltInRegistries.ENTITY_TYPE.getKey(entity.getType()).toString(),
                    new Vec3(entity.getX(), entity.getY(), entity.getZ()),
                    entity.getName().getString(),
                    health,
                    maxHealth
            ));
        }
        return result;
    }

    @Override
    public long getGameTime(String dimension) {
        ServerLevel level = getLevel(dimension);
        if (level == null) return 0;
        return level.getGameTime();
    }

    @Override
    public WeatherInfo getWeather(String dimension) {
        ServerLevel level = getLevel(dimension);
        if (level == null) return new WeatherInfo(false, false, 0, 0);
        return new WeatherInfo(
                level.isRaining(),
                level.isThundering(),
                (int) level.getRainLevel(0),
                (int) level.getThunderLevel(0)
        );
    }

    @Override
    public List<String> getDimensions() {
        MinecraftServer server = BotAccess.getServer();
        if (server == null) return List.of();
        return server.levelKeys().stream()
                .map(key -> key.location().toString())
                .collect(Collectors.toList());
    }

    // ---- 辅助方法 ---- //

    private ServerLevel getLevel(String dimension) {
        MinecraftServer server = BotAccess.getServer();
        if (server == null) return null;
        if (dimension == null || dimension.isEmpty()) return server.overworld();

        ResourceLocation dimId = ResourceLocation.tryParse(dimension);
        if (dimId == null) {
            return switch (dimension.toLowerCase()) {
                case "overworld" -> server.overworld();
                case "nether" -> server.getLevel(Level.NETHER);
                case "end" -> server.getLevel(Level.END);
                default -> server.overworld();
            };
        }
        return server.getLevel(ResourceKey.create(
                net.minecraft.core.registries.Registries.DIMENSION, dimId));
    }
}
