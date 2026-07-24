package io.alice.mod.adapter.world;

import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.level.Level;

public final class DimensionResolver {
    private DimensionResolver() {}

    public static ServerLevel resolve(MinecraftServer server, String dimension) {
        if (server == null) return null;
        if (dimension == null || dimension.isBlank()) return server.overworld();

        String normalized = dimension.toLowerCase();
        return switch (normalized) {
            case "overworld", "minecraft:overworld" -> server.overworld();
            case "nether", "minecraft:the_nether" -> server.getLevel(Level.NETHER);
            case "end", "minecraft:the_end" -> server.getLevel(Level.END);
            default -> server.getAllLevels().stream()
                    .filter(level -> level.dimension().location().toString().equals(dimension))
                    .findFirst()
                    .orElse(null);
        };
    }
}
