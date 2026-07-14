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
 * EventLogRepository 单元测试。
 */
class EventLogRepositoryTest {

    private Path tempDir;
    private EventLogRepository repo;

    @BeforeEach
    void setUp() throws SQLException, IOException {
        tempDir = Files.createTempDirectory("alice-event-test-");
        var db = new DatabaseManager(tempDir.resolve("test.db"), "test_world", "test-instance");
        db.initialize();
        repo = db.eventLogs();
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

    private EventLogRepository.EventLogEntry createEntry(String eventType, String source, String detail) {
        return new EventLogRepository.EventLogEntry(
                0, eventType, source, detail, "{}",
                "test_world", "test-instance", null
        );
    }

    @Test
    void testInsert() {
        long id = repo.insert(createEntry("bot_spawn", "bot1", "Bot spawned at world spawn"));
        assertTrue(id > 0);
        assertEquals(1, repo.count());
    }

    @Test
    void testQueryByType() {
        repo.insert(createEntry("bot_spawn", "bot1", "spawned"));
        repo.insert(createEntry("bot_death", "bot1", "died"));
        repo.insert(createEntry("bot_spawn", "bot2", "spawned"));

        List<EventLogRepository.EventLogEntry> spawnEvents = repo.queryByType("bot_spawn", 10);
        assertEquals(2, spawnEvents.size());
    }

    @Test
    void testQueryByTimeRange() {
        for (int i = 0; i < 5; i++) {
            repo.insert(createEntry("test_event", "system", "event " + i));
        }

        List<EventLogRepository.EventLogEntry> recent = repo.queryByTimeRange(3, 0);
        assertEquals(3, recent.size());
    }

    @Test
    void testQueryBySource() {
        repo.insert(createEntry("bot_spawn", "bot1", "spawned"));
        repo.insert(createEntry("bot_death", "bot1", "died"));
        repo.insert(createEntry("world_switch", "system", "switched"));

        assertEquals(2, repo.queryBySource("bot1", 10).size());
        assertEquals(1, repo.queryBySource("system", 10).size());
    }

    @Test
    void testQueryRecent() {
        for (int i = 0; i < 10; i++) {
            repo.insert(createEntry("event", "src", "event " + i));
        }

        List<EventLogRepository.EventLogEntry> recent = repo.queryRecent(3);
        assertEquals(3, recent.size());
    }

    @Test
    void testCleanOld() {
        for (int i = 0; i < 10; i++) {
            repo.insert(createEntry("event", "src", "event " + i));
        }

        int deleted = repo.cleanOld(5);
        assertTrue(deleted >= 5);
        assertTrue(repo.count() <= 5);
    }

    @Test
    void testEmptyRepository() {
        assertEquals(0, repo.count());
        assertTrue(repo.queryRecent(10).isEmpty());
        assertTrue(repo.queryByType("bot_spawn", 10).isEmpty());
        assertTrue(repo.queryBySource("system", 10).isEmpty());
    }

    @Test
    void testMultipleEventTypes() {
        String[] types = {"bot_spawn", "bot_death", "bot_despawn", "world_switch", "connection", "error"};
        for (String type : types) {
            repo.insert(createEntry(type, "system", type + " occurred"));
        }

        assertEquals(6, repo.count());
        for (String type : types) {
            assertEquals(1, repo.queryByType(type, 10).size());
        }
    }

    @Test
    void testDetailAndData() {
        var entry = new EventLogRepository.EventLogEntry(
                0, "bot_spawn", "bot1", "Bot Alice spawned at x=100, y=64, z=200",
                "{\"x\":100,\"y\":64,\"z\":200}", "test_world", "test-instance", null);
        repo.insert(entry);

        var results = repo.queryByType("bot_spawn", 10);
        assertEquals(1, results.size());
        assertTrue(results.get(0).detail().contains("Alice"));
        assertTrue(results.get(0).data().contains("x"));
    }
}