package io.alice.mod.adapter.persistence;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.SQLException;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * MemoryMetaRepository 单元测试。
 */
class MemoryMetaRepositoryTest {

    private Path tempDir;
    private MemoryMetaRepository repo;

    @BeforeEach
    void setUp() throws SQLException, IOException {
        tempDir = Files.createTempDirectory("alice-memory-test-");
        var db = new DatabaseManager(tempDir.resolve("test.db"), "test", "id");
        db.initialize();
        repo = db.memoryMeta();
    }

    @AfterEach
    void tearDown() {
        if (tempDir != null) {
            try (var files = Files.walk(tempDir)) {
                files.sorted(java.util.Comparator.reverseOrder())
                        .forEach(p -> { try { Files.deleteIfExists(p); } catch (IOException ignored) {} });
            } catch (IOException ignored) {}
        }
    }

    private MemoryMetaRepository.MemoryMetaEntry createEntry(
            String type, String name, String dimension, int chunkX, int chunkZ, int importance) {
        return new MemoryMetaRepository.MemoryMetaEntry(
                0, type, name, dimension, chunkX, chunkZ,
                "{}", importance, "", null, null
        );
    }

    @Test
    void testInsert() {
        long id = repo.insert(createEntry("map_point", "Base", "minecraft:overworld", 0, 0, 3));
        assertTrue(id > 0);
        assertEquals(1, repo.count());
    }

    @Test
    void testUpdate() {
        long id = repo.insert(createEntry("map_point", "Old Name", "minecraft:overworld", 0, 0, 1));
        repo.update(id, createEntry("map_point", "New Name", "minecraft:overworld", 0, 0, 5));

        List<MemoryMetaRepository.MemoryMetaEntry> entries = repo.queryByType("map_point");
        assertEquals(1, entries.size());
        assertEquals("New Name", entries.get(0).name());
        assertEquals(5, entries.get(0).importance());
    }

    @Test
    void testDelete() {
        long id = repo.insert(createEntry("map_point", "Temp", "minecraft:overworld", 0, 0, 1));
        assertEquals(1, repo.count());
        repo.delete(id);
        assertEquals(0, repo.count());
    }

    @Test
    void testQueryByType() {
        repo.insert(createEntry("map_point", "Point1", "minecraft:overworld", 0, 0, 1));
        repo.insert(createEntry("map_point", "Point2", "minecraft:overworld", 1, 1, 2));
        repo.insert(createEntry("map_region", "Region1", "minecraft:overworld", 5, 5, 3));

        assertEquals(2, repo.queryByType("map_point").size());
        assertEquals(1, repo.queryByType("map_region").size());
    }

    @Test
    void testQueryByChunkRange() {
        repo.insert(createEntry("point", "A", "minecraft:overworld", 0, 0, 1));
        repo.insert(createEntry("point", "B", "minecraft:overworld", 5, 5, 2));
        repo.insert(createEntry("point", "C", "minecraft:overworld", 10, 10, 3));
        repo.insert(createEntry("point", "D", "minecraft:the_nether", 0, 0, 1));

        List<MemoryMetaRepository.MemoryMetaEntry> results = repo.queryByChunkRange(
                "minecraft:overworld", -1, 6, -1, 6);
        assertEquals(2, results.size());
        assertEquals("B", results.get(0).name());
        assertEquals("A", results.get(1).name());
    }

    @Test
    void testQueryByImportance() {
        repo.insert(createEntry("point", "Low", "minecraft:overworld", 0, 0, 1));
        repo.insert(createEntry("point", "Medium", "minecraft:overworld", 1, 1, 3));
        repo.insert(createEntry("point", "High", "minecraft:overworld", 2, 2, 5));

        List<MemoryMetaRepository.MemoryMetaEntry> important = repo.queryByImportance(3);
        assertEquals(2, important.size());
        assertTrue(important.stream().allMatch(e -> e.importance() >= 3));
    }

    @Test
    void testQueryByTag() {
        var entry1 = new MemoryMetaRepository.MemoryMetaEntry(
                0, "map_point", "Home", "minecraft:overworld", 0, 0,
                "{}", 3, "base,home,chest", null, null);
        var entry2 = new MemoryMetaRepository.MemoryMetaEntry(
                0, "map_point", "Mine", "minecraft:overworld", 5, 5,
                "{}", 2, "mine,ore", null, null);

        repo.insert(entry1);
        repo.insert(entry2);

        assertEquals(1, repo.queryByTag("home").size());
        assertEquals(1, repo.queryByTag("mine").size());
        assertEquals(0, repo.queryByTag("village").size());
    }

    @Test
    void testQueryAll() {
        for (int i = 0; i < 10; i++) {
            repo.insert(createEntry("point", "P" + i, "minecraft:overworld", i, i, 1));
        }

        assertEquals(10, repo.queryAll(100, 0).size());
        assertEquals(3, repo.queryAll(3, 0).size());
        assertEquals(3, repo.queryAll(3, 3).size());
    }

    @Test
    void testEmptyRepository() {
        assertEquals(0, repo.count());
        assertTrue(repo.queryAll(10, 0).isEmpty());
        assertTrue(repo.queryByType("map_point").isEmpty());
        assertTrue(repo.queryByImportance(1).isEmpty());
    }

    @Test
    void testDataJsonField() {
        var entry = new MemoryMetaRepository.MemoryMetaEntry(
                0, "map_point", "Chest", "minecraft:overworld", 0, 0,
                "{\"items\":64,\"type\":\"chest\"}", 2, "", null, null);
        repo.insert(entry);

        var results = repo.queryByType("map_point");
        assertEquals(1, results.size());
        assertTrue(results.get(0).data().contains("items"));
    }
}