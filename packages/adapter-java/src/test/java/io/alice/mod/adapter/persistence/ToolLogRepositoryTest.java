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
 * ToolLogRepository 单元测试。
 */
class ToolLogRepositoryTest {

    private Path tempDir;
    private ToolLogRepository repo;

    @BeforeEach
    void setUp() throws SQLException, IOException {
        tempDir = Files.createTempDirectory("alice-tool-log-test-");
        var db = new DatabaseManager(tempDir.resolve("test.db"), "test_world", "test-instance");
        db.initialize();
        repo = db.toolLogs();
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

    private ToolLogRepository.ToolLogEntry createEntry(String toolName, boolean success, long durationMs) {
        return new ToolLogRepository.ToolLogEntry(
                0, toolName, "{}", success, "completed", durationMs,
                "test_world", "test-instance", "bot1", null
        );
    }

    @Test
    void testInsert() {
        long id = repo.insert(createEntry("move_to", true, 100));
        assertTrue(id > 0);
        assertEquals(1, repo.count());
    }

    @Test
    void testInsertAll() {
        repo.insertAll(List.of(
                createEntry("move_to", true, 100),
                createEntry("dig", true, 200),
                createEntry("place", false, 50)
        ));
        assertEquals(3, repo.count());
    }

    @Test
    void testQueryRecent() {
        for (int i = 0; i < 10; i++) {
            repo.insert(createEntry("tool_" + i, true, i * 10));
        }

        List<ToolLogRepository.ToolLogEntry> recent = repo.queryRecent(3);
        assertEquals(3, recent.size());
        assertTrue(recent.get(0).id() > recent.get(2).id());
    }

    @Test
    void testQueryByToolName() {
        repo.insert(createEntry("move_to", true, 100));
        repo.insert(createEntry("dig", true, 200));
        repo.insert(createEntry("move_to", false, 50));

        List<ToolLogRepository.ToolLogEntry> moveLogs = repo.queryByToolName("move_to", 10);
        assertEquals(2, moveLogs.size());
    }

    @Test
    void testQueryByWorld() {
        repo.insert(new ToolLogRepository.ToolLogEntry(
                0, "move_to", "{}", true, "ok", 100,
                "world1", "inst1", "bot1", null
        ));
        repo.insert(new ToolLogRepository.ToolLogEntry(
                0, "dig", "{}", true, "ok", 200,
                "world2", "inst2", "bot1", null
        ));

        assertEquals(1, repo.queryByWorld("world1", 10).size());
        assertEquals(1, repo.queryByWorld("world2", 10).size());
    }

    @Test
    void testCountByTool() {
        repo.insert(createEntry("move_to", true, 100));
        repo.insert(createEntry("move_to", true, 150));
        repo.insert(createEntry("dig", true, 200));

        var counts = repo.countByTool();
        assertEquals(2, counts.get("move_to"));
        assertEquals(1, counts.get("dig"));
    }

    @Test
    void testCleanOld() {
        for (int i = 0; i < 10; i++) {
            repo.insert(createEntry("tool", true, i * 10));
        }

        int deleted = repo.cleanOld(5);
        assertTrue(deleted >= 5);
        assertTrue(repo.count() <= 5);
    }

    @Test
    void testEmptyRepository() {
        assertEquals(0, repo.count());
        assertTrue(repo.queryRecent(10).isEmpty());
        assertTrue(repo.countByTool().isEmpty());
    }

    @Test
    void testQueryByTimeRange() {
        for (int i = 0; i < 5; i++) {
            repo.insert(createEntry("tool", true, i * 10));
        }

        List<ToolLogRepository.ToolLogEntry> results = repo.queryByTimeRange(2, 2);
        assertEquals(2, results.size());
    }

    @Test
    void testSuccessAndFailure() {
        repo.insert(createEntry("success_tool", true, 100));
        repo.insert(createEntry("fail_tool", false, 50));

        var all = repo.queryRecent(10);
        assertEquals(2, all.size());
        assertTrue(all.stream().anyMatch(e -> e.success()));
        assertTrue(all.stream().anyMatch(e -> !e.success()));
    }
}