package io.alice.mod.adapter.bot;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import java.lang.reflect.Method;

import static org.junit.jupiter.api.Assertions.*;

/**
 * {@link BotManager} 名称验证逻辑的单元测试。
 * <p>
 * 通过反射调用私有方法 {@code validateName} 进行测试。
 */
class BotManagerValidateNameTest {

    private static Method validateNameMethod;

    static {
        try {
            validateNameMethod = BotManager.class.getDeclaredMethod("validateName", String.class);
            validateNameMethod.setAccessible(true);
        } catch (NoSuchMethodException e) {
            throw new RuntimeException(e);
        }
    }

    private void validateName(String name) {
        try {
            validateNameMethod.invoke(null, name);
        } catch (java.lang.reflect.InvocationTargetException e) {
            if (e.getCause() instanceof RuntimeException re) {
                throw re;
            }
            throw new RuntimeException(e);
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    @Test
    void shouldAcceptValidNames() {
        assertDoesNotThrow(() -> validateName("Alice"));
        assertDoesNotThrow(() -> validateName("Bot_123"));
        assertDoesNotThrow(() -> validateName("a"));
        assertDoesNotThrow(() -> validateName("ABCDEFGHIJKLMNOP")); // 16 chars
    }

    @ParameterizedTest
    @ValueSource(strings = {"", "   ", "Bot Name", "Alice!", "bot@minecraft", "玩家", "a-b-c"})
    void shouldRejectInvalidNames(String invalidName) {
        assertThrows(IllegalArgumentException.class, () -> validateName(invalidName));
    }

    @Test
    void shouldRejectNullName() {
        assertThrows(IllegalArgumentException.class, () -> validateName(null));
    }

    @Test
    void shouldRejectTooLongName() {
        // 17 characters
        assertThrows(IllegalArgumentException.class, () -> validateName("ABCDEFGHIJKLMNOPQ"));
    }

    @Test
    void shouldAcceptMaxLengthName() {
        // Exactly 16 characters
        assertDoesNotThrow(() -> validateName("ABCDEFGHIJKLMNOP"));
    }

    @Test
    void shouldAcceptUnderscore() {
        assertDoesNotThrow(() -> validateName("test_bot_1"));
    }

    @Test
    void shouldAcceptNumbers() {
        assertDoesNotThrow(() -> validateName("bot123"));
    }

    @Test
    void shouldAcceptOnlyNumbers() {
        // Minecraft 玩家名允许纯数字
        assertDoesNotThrow(() -> validateName("12345678"));
    }

    @Test
    void validateNameConstants() {
        assertEquals(16, BotManager.MAX_NAME_LENGTH);
        assertNotNull(BotManager.NAME_PATTERN);
    }
}