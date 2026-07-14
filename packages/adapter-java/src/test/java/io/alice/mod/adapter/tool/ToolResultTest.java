package io.alice.mod.adapter.tool;

import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * {@link ToolResult} 的序列化与创建单元测试。
 */
class ToolResultTest {

    @Test
    void shouldCreateOkResult() {
        ToolResult r = ToolResult.ok("success");
        assertTrue(r.success());
        assertEquals("success", r.message());
        assertTrue(r.data().isEmpty());
    }

    @Test
    void shouldCreateOkResultWithData() {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("key", "value");
        ToolResult r = ToolResult.ok("done", data);
        assertTrue(r.success());
        assertEquals("done", r.message());
        assertEquals("value", r.data().get("key"));
    }

    @Test
    void shouldCreateOkResultWithTiming() {
        long start = System.currentTimeMillis();
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("count", 42);
        ToolResult r = ToolResult.ok("done", data, start);
        assertTrue(r.success());
        assertNotNull(r.meta());
        assertTrue((long) r.meta().get("duration") >= 0);
    }

    @Test
    void shouldCreateFailResult() {
        ToolResult r = ToolResult.fail("error");
        assertFalse(r.success());
        assertEquals("UNKNOWN_ERROR", r.errorCode());
        assertEquals("error", r.errorMessage());
    }

    @Test
    void shouldCreateFailResultWithCode() {
        ToolResult r = ToolResult.fail("NOT_FOUND", "Bot not found");
        assertFalse(r.success());
        assertEquals("NOT_FOUND", r.errorCode());
        assertEquals("Bot not found", r.errorMessage());
    }

    @Test
    void shouldCreateFailResultWithTiming() {
        long start = System.currentTimeMillis();
        ToolResult r = ToolResult.fail("ERR", "fail", start);
        assertFalse(r.success());
        assertNotNull(r.meta());
        assertTrue((long) r.meta().get("duration") >= 0);
    }

    @Test
    void shouldCreateDbgResultWithDetails() {
        Map<String, Object> details = new LinkedHashMap<>();
        details.put("reason", "timeout");
        ToolResult r = ToolResult.fail("TIMEOUT", "Operation timed out", details);
        assertFalse(r.success());
        assertEquals("TIMEOUT", r.errorCode());
        assertEquals(details, r.errorDetails());
    }

    // ---- 序列化测试 ---- //

    @Test
    void toJsonShouldIncludeSuccess() {
        ToolResult r = ToolResult.ok("ok");
        String json = r.toJson();
        assertTrue(json.contains("\"success\":true"));
    }

    @Test
    void toJsonShouldIncludeDataOnSuccess() {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("uuid", "abc-123");
        ToolResult r = ToolResult.ok("created", data);
        String json = r.toJson();
        assertTrue(json.contains("abc-123"), "JSON should contain data value: " + json);
        assertTrue(json.contains("created"), "JSON should contain message: " + json);
    }

    @Test
    void toJsonShouldIncludeErrorOnFailure() {
        ToolResult r = ToolResult.fail("ERR", "something went wrong");
        String json = r.toJson();
        assertTrue(json.contains("ERR"), "JSON should contain error code: " + json);
        assertTrue(json.contains("something went wrong"), "JSON should contain error message: " + json);
    }

    @Test
    void toJsonShouldIncludeNestedData() {
        Map<String, Object> nested = new LinkedHashMap<>();
        nested.put("x", 10);
        nested.put("y", 20);
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("position", nested);
        ToolResult r = ToolResult.ok("ok", data);
        String json = r.toJson();
        assertTrue(json.contains("\"x\":10"), "JSON should contain nested x: " + json);
        assertTrue(json.contains("\"y\":20"), "JSON should contain nested y: " + json);
    }

    @Test
    void toJsonShouldIncludeListData() {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("items", List.of("a", "b", "c"));
        ToolResult r = ToolResult.ok("ok", data);
        String json = r.toJson();
        assertTrue(json.contains("\"a\""), "JSON should contain list item: " + json);
        assertTrue(json.contains("\"b\""), "JSON should contain list item: " + json);
    }

    @Test
    void toJsonShouldHandleNullData() {
        ToolResult r = ToolResult.ok("ok", null);
        String json = r.toJson();
        assertTrue(json.contains("\"success\":true"));
        assertNotNull(json);
    }

    @Test
    void toJsonShouldHandleMixedTypes() {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("name", "Alice");
        data.put("count", 42);
        data.put("ratio", 3.14);
        data.put("active", true);
        ToolResult r = ToolResult.ok("ok", data);
        String json = r.toJson();
        assertTrue(json.contains("\"name\":\"Alice\""));
        assertTrue(json.contains("\"count\":42"));
        assertTrue(json.contains("\"ratio\":3.14"));
        assertTrue(json.contains("\"active\":true"));
    }

    @Test
    void toJsonShouldIncludeMeta() {
        Map<String, Object> meta = new LinkedHashMap<>();
        meta.put("duration", 150);
        // Use fail with timing to get meta
        long start = System.currentTimeMillis();
        // Simulate a short delay
        ToolResult r = ToolResult.ok("done", Map.of(), start);
        String json = r.toJson();
        assertTrue(json.contains("\"meta\""), "JSON should contain meta: " + json);
        assertTrue(json.contains("\"duration\""), "JSON should contain duration: " + json);
    }
}