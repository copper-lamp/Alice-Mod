package io.alice.mod.adapter.tool.service;

import carpet.patches.EntityPlayerMPFake;
import io.alice.mod.adapter.api.service.BotHandle;
import io.alice.mod.adapter.api.service.BotInfo;
import io.alice.mod.adapter.api.service.BotService;
import io.alice.mod.adapter.api.types.Vec3;
import io.alice.mod.adapter.bot.BotManager;
import io.alice.mod.adapter.ai.BotAccess;
import io.alice.mod.adapter.world.WorldContextManager;
import net.minecraft.core.BlockPos;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.level.Level;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * {@link BotService} 实现。
 * 桥接到 {@link BotManager} 和 {@link BotAccess}。
 */
public class BotServiceImpl implements BotService {

    private static final Logger LOG = LoggerFactory.getLogger(BotServiceImpl.class);

    @Override
    public BotHandle spawn(String name, Vec3 position, String dimension) {
        MinecraftServer server = BotAccess.getServer();
        if (server == null) {
            throw new IllegalStateException("MinecraftServer not available");
        }
        ServerLevel level = resolveDimension(server, dimension);
        if (level == null) {
            throw new IllegalArgumentException("Invalid dimension: " + dimension);
        }
        EntityPlayerMPFake bot = BotManager.spawn(server, name, level,
                new net.minecraft.world.phys.Vec3(position.x(), position.y(), position.z()));
        return new BotHandleImpl(bot);
    }

    @Override
    public boolean despawn(String nameOrUuid) {
        EntityPlayerMPFake bot = resolveBot(nameOrUuid);
        return bot != null && BotManager.despawn(bot);
    }

    @Override
    public boolean dismiss(String nameOrUuid) {
        // 先尝试 UUID
        try {
            UUID uuid = UUID.fromString(nameOrUuid);
            return BotManager.dismiss(uuid);
        } catch (IllegalArgumentException ignored) {}
        return BotManager.dismissByName(nameOrUuid);
    }

    @Override
    public Optional<BotHandle> get(UUID uuid) {
        EntityPlayerMPFake bot = getBotManager().get(uuid);
        return bot != null ? Optional.of(new BotHandleImpl(bot)) : Optional.empty();
    }

    @Override
    public Optional<BotHandle> findByName(String name) {
        EntityPlayerMPFake bot = getBotManager().findByName(name);
        return bot != null ? Optional.of(new BotHandleImpl(bot)) : Optional.empty();
    }

    @Override
    public List<BotHandle> getAllOnline() {
        List<BotHandle> handles = new ArrayList<>();
        for (EntityPlayerMPFake bot : getBotManager().findAll()) {
            handles.add(new BotHandleImpl(bot));
        }
        return handles;
    }

    @Override
    public List<BotInfo> listAll() {
        List<BotManager.BotInfo> allBots = getBotManager().listAll();
        List<BotInfo> result = new ArrayList<>();
        for (BotManager.BotInfo info : allBots) {
            result.add(new BotInfo(
                    info.uuid(),
                    info.name(),
                    info.online(),
                    info.dimension() != null ? info.dimension().toString() : "unknown",
                    new Vec3(info.position().getX(), info.position().getY(), info.position().getZ()),
                    info.health(),
                    info.maxHealth(),
                    info.createdAt()
            ));
        }
        return result;
    }

    @Override
    public boolean isBot(UUID uuid) {
        return getBotManager().get(uuid) != null;
    }

    // ---- 辅助方法 ---- //

    private static BotManager getBotManager() {
        return WorldContextManager.getActive().getBotManager();
    }

    private static EntityPlayerMPFake resolveBot(String nameOrUuid) {
        BotManager mgr = getBotManager();
        try {
            UUID uuid = UUID.fromString(nameOrUuid);
            EntityPlayerMPFake bot = mgr.get(uuid);
            if (bot != null) return bot;
        } catch (IllegalArgumentException ignored) {}
        return mgr.findByName(nameOrUuid);
    }

    private static ServerLevel resolveDimension(MinecraftServer server, String dimension) {
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

    /** BotHandle 实现，封装 EntityPlayerMPFake。 */
    private static class BotHandleImpl implements BotHandle {
        private final EntityPlayerMPFake player;

        BotHandleImpl(EntityPlayerMPFake player) {
            this.player = player;
        }

        @Override
        public UUID uuid() { return player.getUUID(); }

        @Override
        public String name() { return player.getName().getString(); }

        @Override
        public Vec3 position() {
            net.minecraft.world.phys.Vec3 pos = player.position();
            return new Vec3(pos.x(), pos.y(), pos.z());
        }

        @Override
        public String dimension() {
            return ((ServerLevel) player.level()).dimension().location().toString();
        }

        @Override
        public float health() { return player.getHealth(); }

        @Override
        public float maxHealth() { return player.getMaxHealth(); }

        @Override
        public int foodLevel() { return player.getFoodData().getFoodLevel(); }

        @Override
        public int experienceLevel() { return player.experienceLevel; }

        @Override
        public void teleport(double x, double y, double z, String dimension) {
            MinecraftServer server = BotAccess.getServer();
            if (server == null) return;
            ServerLevel level = resolveDimension(server, dimension);
            if (level != null) {
                player.teleportTo(level, x, y, z, java.util.Set.of(),
                        player.getYRot(), player.getXRot(), false);
            }
        }

        @Override
        @SuppressWarnings("unchecked")
        public <T> T getNativePlayer() {
            return (T) player;
        }
    }
}
