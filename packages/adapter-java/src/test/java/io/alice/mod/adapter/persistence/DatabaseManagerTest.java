package io.alice.mod.adapter.persistence;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.SQLException;

import static org.junit.jupiter.api.Assertions.*;

/**
 * DatabaseManager 单元测试。
 */
class DatabaseManagerTest {

    private Path tempDir;
    private DatabaseManager dbManager;

    @BeforeEach
    void setUp() throws SQLException, IOException {
        tempDir = Files.createTempDirectory("alice-db-test-");
        Path dbPath = tempDir.resolve("test.db");
        dbManager = new DatabaseManager(dbPath, "test_world", "test-instance-001");
        dbManager.initialize();
    }

    @AfterEach
    void tearDown() throws IOException {
        if (dbManager != null) {
            dbManager.close();
        }
        // 清理临时目录
        if (tempDir != null) {
            try (var files = Files.walk(tempDir)) {
                files.sorted(java.util.Comparator.reverseOrder())
                        .forEach(p -> {
                            try { Files.deleteIfExists(p); } catch (IOException ignored) {}
                        });
            }
        }
    }

    @Test
    void testInitialization() {
        assertTrue(dbManager.isInitialized());
        assertNotNull(dbManager.configs());
        assertNotNull(dbManager.toolLogs());
        assertNotNull(dbManager.memoryMeta());
        assertNotNull(dbManager.eventLogs());
    }

    @Test
    void testInitializationIdempotent() throws SQLException {
        // 多次调用 initialize() 应该安全
        dbManager.initialize();
        dbManager.initialize();
        assertTrue(dbManager.isInitialized());
    }

    @Test
    void testClose() {
        dbManager.close();
        assertFalse(dbManager.isInitialized());

        // 多次 close() 应该安全
        dbManager.close();
        assertFalse(dbManager.isInitialized());
    }

    @Test
    void testDatabaseFileCreated() {
        assertTrue(tempDir.resolve("test.db").toFile().exists());
    }

    @Test
    void testGetWorldName() {
        assertEquals("test_world", dbManager.getWorldName());
    }

    @Test
    void testGetInstanceId() {
        assertEquals("test-instance-001", dbManager.getInstanceId());
    }

    @Test
    void testAccessBeforeInitialization() throws IOException {
        Path uninitPath = Files.createTempDirectory("alice-db-uninit-");
        DatabaseManager uninit = new DatabaseManager(uninitPath.resolve("uninit.db"), "uninit", "id");
        assertThrows(IllegalStateException.class, uninit::configs);
        assertThrows(IllegalStateException.class, uninit::toolLogs);
        assertThrows(IllegalStateException.class, uninit::memoryMeta);
        assertThrows(IllegalStateException.class, uninit::eventLogs);
    }

    @Test
    void testCleanOldLogs() {
        // 插入几条日志
        for (int i = 0; i < 5; i++) {
            dbManager.toolLogs().insert(new ToolLogRepository.ToolLogEntry(
                    0, "test_tool", "{}", true, "ok", 10,
                    "test_world", "test-instance-001", "bot1", null
            ));
            dbManager.eventLogs().insert(new EventLogRepository.EventLogEntry(
                    0, "test_event", "system", "test", "{}",
                    "test_world", "test-instance-001", null
            ));
        }

        assertEquals(5, dbManager.toolLogs().count());
        assertEquals(5, dbManager.eventLogs().count());

        // 清理后保留 3 条
        dbManager.cleanOldLogs(3, 3);

        assertTrue(dbManager.toolLogs().count() <= 3);
        assertTrue(dbManager.eventLogs().count() <= 3);
    }

    @Test
    void testSchemaVersion() throws SQLException {
        var conn = dbManager.getConnection();
        try (var stmt = conn.createStatement();
             var rs = stmt.executeQuery("SELECT MAX(version) FROM schema_version")) {
            assertTrue(rs.next());
            assertEquals(1, rs.getInt(1));
        }
    }

    @Test
    void testPragmaSettings() throws SQLException {
        var conn = dbManager.getConnection();
        try (var stmt = conn.createStatement();
             var rs = stmt.executeQuery("PRAGMA journal_mode")) {
            assertTrue(rs.next());
            assertEquals("wal", rs.getString(1).toLowerCase());
        }

        try (var stmt = conn.createStatement();
             var rs = stmt.executeQuery("PRAGMA foreign_keys")) {
            assertTrue(rs.next());
            assertEquals(1, rs.getInt(1));
        }
    }
}