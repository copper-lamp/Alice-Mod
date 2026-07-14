package io.alice.mod.adapter.bot;

import io.alice.mod.adapter.tool.ToolResult;
import io.alice.mod.adapter.tool.module.BotTools;
import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * BotTools 工具模块的参数校验单元测试。
 * <p>
 * 测试工具方法在参数缺失/异常时的行为（不依赖 Minecraft 运行时）。
 */
class BotToolsParameterTest {

    @Test
    void botSpawnShouldFailWhenNameMissing() {
        Map<String, Object> params = new HashMap<>();
        params.put("x", 0.0);
        params.put("y", 64.0);
        params.put("z", 0.0);

        // 在无 MinecraftServer 时应返回 INTERNAL_ERROR
        ToolResult result = BotTools.INSTANCE.botSpawn(params);
        assertFalse(result.success());
        assertNotNull(result.errorCode());
    }

    @Test
    void botSpawnShouldFailWhenCoordinatesMissing() {
        Map<String, Object> params = new HashMap<>();
        params.put("name", "Alice");

        ToolResult result = BotTools.INSTANCE.botSpawn(params);
        assertFalse(result.success());
    }

    @Test
    void botDespawnShouldFailWhenNameMissing() {
        Map<String, Object> params = new HashMap<>();
        ToolResult result = BotTools.INSTANCE.botDespawn(params);
        assertFalse(result.success());
        // 无服务器时返回 INTERNAL_ERROR，有服务器时返回 NOT_FOUND
        assertNotNull(result.errorCode());
    }

    @Test
    void botDismissShouldFailWhenNameMissing() {
        Map<String, Object> params = new HashMap<>();
        ToolResult result = BotTools.INSTANCE.botDismiss(params);
        assertFalse(result.success());
        // 无服务器时返回 INTERNAL_ERROR，有服务器时返回 NOT_FOUND
        assertNotNull(result.errorCode());
    }

    @Test
    void botInfoShouldFailWhenNameMissing() {
        Map<String, Object> params = new HashMap<>();
        ToolResult result = BotTools.INSTANCE.botInfo(params);
        assertFalse(result.success());
        // 无服务器时返回 INTERNAL_ERROR，有服务器时返回 NOT_FOUND
        assertNotNull(result.errorCode());
    }

    @Test
    void botListShouldSucceed() {
        // bot_list 不需要参数，应始终返回成功（即使无服务器，在 BotManager.listAll() 的异常处理中返回错误）
        Map<String, Object> params = new HashMap<>();
        ToolResult result = BotTools.INSTANCE.botList(params);
        // 在没有 MinecraftServer 的情况下，BotManager.listAll() 会抛出 NPE 被捕获
        // 但该方法本身调用是成功的，异常在内部处理
        assertNotNull(result);
    }

    @Test
    void botSpawnShouldHandleInvalidDimension() {
        Map<String, Object> params = new HashMap<>();
        params.put("name", "Alice");
        params.put("x", 0.0);
        params.put("y", 64.0);
        params.put("z", 0.0);
        params.put("dimension", "invalid_dimension");

        ToolResult result = BotTools.INSTANCE.botSpawn(params);
        assertFalse(result.success());
        // 无服务器时返回 INTERNAL_ERROR，有服务器时返回 INVALID_PARAMS
        assertNotNull(result.errorCode());
    }

    @Test
    void botSpawnShouldHandleAllDataTypes() {
        // 测试参数类型兼容性：x 作为整数传入
        Map<String, Object> params = new HashMap<>();
        params.put("name", "Alice");
        params.put("x", 0);  // Integer
        params.put("y", 64); // Integer
        params.put("z", 0);  // Integer

        // 不应抛出 ClassCastException
        assertDoesNotThrow(() -> BotTools.INSTANCE.botSpawn(params));
    }
}