package io.alice.mod.adapter.bot;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

/**
 * {@link AliceBotPlayer} 工具方法的单元测试。
 * <p>
 * 测试不依赖 Minecraft 运行时环境的静态方法。
 */
class AliceBotPlayerTest {

    @Test
    void shouldDefineConstants() {
        assertEquals(16, BotManager.MAX_NAME_LENGTH);
        assertEquals("^[a-zA-Z0-9_]+$", BotManager.NAME_PATTERN);
    }

    @Test
    void shouldCreateBotEntry() {
        var dim = net.minecraft.resources.ResourceLocation.parse("minecraft:overworld");
        var pos = new net.minecraft.core.BlockPos(10, 64, 20);
        BotEntry entry = new BotEntry("Alice", dim, pos);
        assertEquals("Alice", entry.name());
        assertEquals(dim, entry.dimension());
        assertEquals(pos, entry.position());
        assertTrue(entry.createdAt() > 0);
    }

    @Test
    void shouldCreateBotEntryWithTimestamp() {
        var dim = net.minecraft.resources.ResourceLocation.parse("minecraft:the_nether");
        var pos = new net.minecraft.core.BlockPos(0, 80, 0);
        BotEntry entry = new BotEntry("Bot", dim, pos, 5000L);
        assertEquals(5000L, entry.createdAt());
    }

    @Test
    void shouldHandleBotInfoRecord() {
        var uuid = java.util.UUID.randomUUID();
        var dim = net.minecraft.resources.ResourceLocation.parse("minecraft:overworld");
        var pos = new net.minecraft.core.BlockPos(1, 2, 3);
        BotManager.BotInfo info = new BotManager.BotInfo(uuid, "TestBot", true, dim, pos, 20.0f, 20.0f, 1000L);

        assertEquals(uuid, info.uuid());
        assertEquals("TestBot", info.name());
        assertTrue(info.online());
        assertEquals(dim, info.dimension());
        assertEquals(pos, info.position());
        assertEquals(20.0f, info.health());
        assertEquals(20.0f, info.maxHealth());
        assertEquals(1000L, info.createdAt());
    }

    @Test
    void shouldHandleBotInfoOffline() {
        var uuid = java.util.UUID.randomUUID();
        var dim = net.minecraft.resources.ResourceLocation.parse("minecraft:the_end");
        var pos = new net.minecraft.core.BlockPos(0, 0, 0);
        BotManager.BotInfo info = new BotManager.BotInfo(uuid, "OfflineBot", false, dim, pos, 0, 0, 2000L);

        assertFalse(info.online());
        assertEquals(0, info.health());
        assertEquals(0, info.maxHealth());
    }
}