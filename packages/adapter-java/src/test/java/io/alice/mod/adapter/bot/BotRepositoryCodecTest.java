package io.alice.mod.adapter.bot;

import com.mojang.serialization.JsonOps;
import net.minecraft.nbt.NbtOps;
import org.junit.jupiter.api.Test;

import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

/**
 * {@link BotRepository.Entry} Codec 的序列化/反序列化测试。
 * <p>
 * 测试 Entry 记录的直接 Codec 编解码，不依赖 Minecraft 服务端环境。
 */
class BotRepositoryCodecTest {

    @Test
    void shouldEncodeAndDecodeEntry() {
        BotRepository.Entry entry = new BotRepository.Entry("Alice", "minecraft:overworld", 10, 64, 20, 1000L);

        // 编码为 NBT
        var result = BotRepository.Entry.CODEC.encodeStart(NbtOps.INSTANCE, entry);
        assertTrue(result.isSuccess(), "Encoding should succeed");

        // 解码回 Entry
        var decoded = result.flatMap(nbt -> BotRepository.Entry.CODEC.parse(NbtOps.INSTANCE, nbt));
        assertTrue(decoded.isSuccess(), "Decoding should succeed");

        BotRepository.Entry restored = decoded.getOrThrow();
        assertEquals("Alice", restored.name());
        assertEquals("minecraft:overworld", restored.dimension());
        assertEquals(10, restored.x());
        assertEquals(64, restored.y());
        assertEquals(20, restored.z());
        assertEquals(1000L, restored.createdAt());
    }

    @Test
    void shouldHandleNetherDimension() {
        BotRepository.Entry entry = new BotRepository.Entry("NetherBot", "minecraft:the_nether", 0, 80, 0, 2000L);

        var result = BotRepository.Entry.CODEC.encodeStart(NbtOps.INSTANCE, entry);
        assertTrue(result.isSuccess());

        var decoded = result.flatMap(nbt -> BotRepository.Entry.CODEC.parse(NbtOps.INSTANCE, nbt));
        assertTrue(decoded.isSuccess());

        BotRepository.Entry restored = decoded.getOrThrow();
        assertEquals("NetherBot", restored.name());
        assertEquals("minecraft:the_nether", restored.dimension());
    }

    @Test
    void shouldHandleNegativeCoordinates() {
        BotRepository.Entry entry = new BotRepository.Entry("DeepBot", "minecraft:overworld", -100, -10, -200, 3000L);

        var result = BotRepository.Entry.CODEC.encodeStart(NbtOps.INSTANCE, entry);
        assertTrue(result.isSuccess());

        var decoded = result.flatMap(nbt -> BotRepository.Entry.CODEC.parse(NbtOps.INSTANCE, nbt));
        assertTrue(decoded.isSuccess());

        BotRepository.Entry restored = decoded.getOrThrow();
        assertEquals(-100, restored.x());
        assertEquals(-10, restored.y());
        assertEquals(-200, restored.z());
    }

    @Test
    void shouldHandleZeroTimestamp() {
        BotRepository.Entry entry = new BotRepository.Entry("ZeroBot", "minecraft:overworld", 0, 0, 0, 0L);

        var result = BotRepository.Entry.CODEC.encodeStart(NbtOps.INSTANCE, entry);
        assertTrue(result.isSuccess());

        var decoded = result.flatMap(nbt -> BotRepository.Entry.CODEC.parse(NbtOps.INSTANCE, nbt));
        assertTrue(decoded.isSuccess());

        BotRepository.Entry restored = decoded.getOrThrow();
        assertEquals(0L, restored.createdAt());
    }

    @Test
    void shouldHandleLongNames() {
        String longName = "ABCDEFGHIJKLMNOP"; // 16 chars, max allowed
        BotRepository.Entry entry = new BotRepository.Entry(longName, "minecraft:overworld", 0, 64, 0, 4000L);

        var result = BotRepository.Entry.CODEC.encodeStart(NbtOps.INSTANCE, entry);
        assertTrue(result.isSuccess());

        var decoded = result.flatMap(nbt -> BotRepository.Entry.CODEC.parse(NbtOps.INSTANCE, nbt));
        assertTrue(decoded.isSuccess());

        BotRepository.Entry restored = decoded.getOrThrow();
        assertEquals(longName, restored.name());
    }

    @Test
    void shouldHandleFullMapCodec() {
        // 测试完整的 Map<UUID, Entry> Codec
        UUID uuid1 = UUID.randomUUID();
        UUID uuid2 = UUID.randomUUID();

        BotRepository.Entry entry1 = new BotRepository.Entry("Bot1", "minecraft:overworld", 10, 64, 20, 1000L);
        BotRepository.Entry entry2 = new BotRepository.Entry("Bot2", "minecraft:the_nether", -5, 80, 15, 2000L);

        java.util.Map<UUID, BotRepository.Entry> map = new java.util.HashMap<>();
        map.put(uuid1, entry1);
        map.put(uuid2, entry2);

        // 使用 BotRepository.Entry.CODEC 构建 Map Codec 测试
        var codec = com.mojang.serialization.Codec.unboundedMap(
                net.minecraft.core.UUIDUtil.STRING_CODEC, BotRepository.Entry.CODEC);
        var result = codec.encodeStart(NbtOps.INSTANCE, map);
        assertTrue(result.isSuccess(), "Map encoding should succeed");

        var decoded = result.flatMap(nbt -> codec.parse(NbtOps.INSTANCE, nbt));
        assertTrue(decoded.isSuccess(), "Map decoding should succeed");

        java.util.Map<UUID, BotRepository.Entry> restored = decoded.getOrThrow();
        assertEquals(2, restored.size());
        assertTrue(restored.containsKey(uuid1));
        assertTrue(restored.containsKey(uuid2));
        assertEquals("Bot1", restored.get(uuid1).name());
        assertEquals("minecraft:the_nether", restored.get(uuid2).dimension());
    }
}