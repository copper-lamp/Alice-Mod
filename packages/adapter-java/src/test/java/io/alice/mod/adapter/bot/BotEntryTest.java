package io.alice.mod.adapter.bot;

import net.minecraft.core.BlockPos;
import net.minecraft.resources.ResourceLocation;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/**
 * {@link BotEntry} 的单元测试。
 */
class BotEntryTest {

    private static final ResourceLocation OVERWORLD = ResourceLocation.parse("minecraft:overworld");

    @Test
    void shouldCreateEntryWithAllFields() {
        BlockPos pos = new BlockPos(10, 64, 20);
        BotEntry entry = new BotEntry("Alice", OVERWORLD, pos, 1000L);

        assertEquals("Alice", entry.name());
        assertEquals(OVERWORLD, entry.dimension());
        assertEquals(pos, entry.position());
        assertEquals(1000L, entry.createdAt());
    }

    @Test
    void shouldCreateEntryWithDefaultTimestamp() {
        BlockPos pos = new BlockPos(0, 64, 0);
        BotEntry entry = new BotEntry("Bob", OVERWORLD, pos);

        assertEquals("Bob", entry.name());
        assertEquals(OVERWORLD, entry.dimension());
        assertEquals(pos, entry.position());
        assertTrue(entry.createdAt() > 0);
    }

    @Test
    void shouldHandleNetherDimension() {
        ResourceLocation nether = ResourceLocation.parse("minecraft:the_nether");
        BlockPos pos = new BlockPos(0, 80, 0);
        BotEntry entry = new BotEntry("NetherBot", nether, pos);

        assertEquals(nether, entry.dimension());
    }

    @Test
    void shouldHandleNegativeCoordinates() {
        BlockPos pos = new BlockPos(-100, -10, -200);
        BotEntry entry = new BotEntry("DeepBot", OVERWORLD, pos);

        assertEquals(-100, entry.position().getX());
        assertEquals(-10, entry.position().getY());
        assertEquals(-200, entry.position().getZ());
    }

    @Test
    void shouldBeEqualWhenSameFields() {
        BlockPos pos = new BlockPos(10, 64, 20);
        BotEntry a = new BotEntry("Alice", OVERWORLD, pos, 1000L);
        BotEntry b = new BotEntry("Alice", OVERWORLD, pos, 1000L);

        assertEquals(a, b);
        assertEquals(a.hashCode(), b.hashCode());
    }

    @Test
    void shouldNotBeEqualWhenDifferentName() {
        BlockPos pos = new BlockPos(10, 64, 20);
        BotEntry a = new BotEntry("Alice", OVERWORLD, pos, 1000L);
        BotEntry b = new BotEntry("Bob", OVERWORLD, pos, 1000L);

        assertNotEquals(a, b);
    }
}