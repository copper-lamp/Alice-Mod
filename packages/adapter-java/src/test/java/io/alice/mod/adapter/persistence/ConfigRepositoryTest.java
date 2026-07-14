package io.alice.mod.adapter.persistence;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.SQLException;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * ConfigRepository 单元测试。
 */
class ConfigRepositoryTest {

    private Path tempDir;
    private ConfigRepository repo;

    @BeforeEach
    void setUp() throws SQLException, IOException {
        tempDir = Files.createTempDirectory("alice-config-test-");
        var db = new DatabaseManager(tempDir.resolve("test.db"), "test", "id");
        db.initialize();
        repo = db.configs();
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

    @Test
    void testSetAndGet() {
        repo.set("agent_core.host", "127.0.0.1");
        assertEquals("127.0.0.1", repo.get("agent_core.host").orElse(null));
    }

    @Test
    void testGetNonExistent() {
        assertTrue(repo.get("non_existent_key").isEmpty());
    }

    @Test
    void testOverwrite() {
        repo.set("key1", "value1");
        repo.set("key1", "value2");
        assertEquals("value2", repo.get("key1").orElse(null));
    }

    @Test
    void testSetWithCategory() {
        repo.set("port", "27541", "tcp", "TCP port");
        assertEquals("27541", repo.get("port").orElse(null));
    }

    @Test
    void testRemove() {
        repo.set("key1", "value1");
        assertTrue(repo.exists("key1"));
        repo.remove("key1");
        assertFalse(repo.exists("key1"));
    }

    @Test
    void testGetByCategory() {
        repo.set("host", "127.0.0.1", "tcp", "");
        repo.set("port", "27541", "tcp", "");
        repo.set("max_bots", "10", "bot", "");

        Map<String, String> tcpConfigs = repo.getByCategory("tcp");
        assertEquals(2, tcpConfigs.size());
        assertEquals("127.0.0.1", tcpConfigs.get("host"));
        assertEquals("27541", tcpConfigs.get("port"));
    }

    @Test
    void testGetAll() {
        repo.set("a", "1", "cat1", "");
        repo.set("b", "2", "cat2", "");

        Map<String, String> all = repo.getAll();
        assertEquals(2, all.size());
    }

    @Test
    void testSetAll() {
        repo.setAll(Map.of("k1", "v1", "k2", "v2", "k3", "v3"));
        assertEquals("v1", repo.get("k1").orElse(null));
        assertEquals("v2", repo.get("k2").orElse(null));
        assertEquals("v3", repo.get("k3").orElse(null));
    }

    @Test
    void testCount() {
        assertEquals(0, repo.count());
        repo.set("k1", "v1");
        assertEquals(1, repo.count());
        repo.set("k2", "v2");
        assertEquals(2, repo.count());
    }

    @Test
    void testExists() {
        assertFalse(repo.exists("nonexistent"));
        repo.set("k1", "v1");
        assertTrue(repo.exists("k1"));
    }

    @Test
    void testEmptyAfterRemove() {
        repo.set("k1", "v1");
        repo.remove("k1");
        assertEquals(0, repo.count());
    }

    @Test
    void testLargeValue() {
        String largeValue = "x".repeat(10000);
        repo.set("large_key", largeValue);
        assertEquals(largeValue, repo.get("large_key").orElse(null));
    }
}