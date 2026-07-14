package io.alice.mod.adapter.bot;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

/**
 * {@link BotEventDispatcher} 的单元测试。
 */
class BotEventDispatcherTest {

    private static final UUID BOT_UUID = UUID.randomUUID();

    @AfterEach
    void clearListeners() {
        BotEventDispatcher.ON_SPAWN.clear();
        BotEventDispatcher.ON_DESPAWN.clear();
        BotEventDispatcher.ON_DEATH.clear();
        BotEventDispatcher.ON_DISMISS.clear();
        BotEventDispatcher.ON_RESPAWN.clear();
    }

    @Test
    void shouldFireSpawnEvent() {
        List<String> captured = new ArrayList<>();
        BotEventDispatcher.ON_SPAWN.add((name, uuid) -> captured.add(name + ":" + uuid));

        BotEventDispatcher.fireSpawn("Alice", BOT_UUID);

        assertEquals(1, captured.size());
        assertTrue(captured.get(0).contains("Alice"));
        assertTrue(captured.get(0).contains(BOT_UUID.toString()));
    }

    @Test
    void shouldFireDespawnEvent() {
        List<String> captured = new ArrayList<>();
        BotEventDispatcher.ON_DESPAWN.add((name, uuid) -> captured.add(name));

        BotEventDispatcher.fireDespawn("Bob", UUID.randomUUID());

        assertEquals(1, captured.size());
        assertEquals("Bob", captured.get(0));
    }

    @Test
    void shouldFireDeathEvent() {
        List<String> capturedNames = new ArrayList<>();
        List<String> capturedMessages = new ArrayList<>();
        BotEventDispatcher.ON_DEATH.add((name, uuid, msg) -> {
            capturedNames.add(name);
            capturedMessages.add(msg);
        });

        BotEventDispatcher.fireDeath("Alice", BOT_UUID, "fell from a high place");

        assertEquals(1, capturedNames.size());
        assertEquals("Alice", capturedNames.get(0));
        assertEquals("fell from a high place", capturedMessages.get(0));
    }

    @Test
    void shouldFireDismissEvent() {
        List<UUID> captured = new ArrayList<>();
        BotEventDispatcher.ON_DISMISS.add((name, uuid) -> captured.add(uuid));

        BotEventDispatcher.fireDismiss("Charlie", BOT_UUID);

        assertEquals(1, captured.size());
        assertEquals(BOT_UUID, captured.get(0));
    }

    @Test
    void shouldFireRespawnEvent() {
        List<String> captured = new ArrayList<>();
        BotEventDispatcher.ON_RESPAWN.add((name, uuid) -> captured.add(name));

        BotEventDispatcher.fireRespawn("Dave", UUID.randomUUID());

        assertEquals(1, captured.size());
        assertEquals("Dave", captured.get(0));
    }

    @Test
    void shouldHandleMultipleListeners() {
        List<Integer> counter = new ArrayList<>();
        BotEventDispatcher.ON_SPAWN.add((n, u) -> counter.add(1));
        BotEventDispatcher.ON_SPAWN.add((n, u) -> counter.add(2));
        BotEventDispatcher.ON_SPAWN.add((n, u) -> counter.add(3));

        BotEventDispatcher.fireSpawn("Test", UUID.randomUUID());

        assertEquals(3, counter.size());
        assertTrue(counter.contains(1));
        assertTrue(counter.contains(2));
        assertTrue(counter.contains(3));
    }

    @Test
    void shouldNotThrowWhenListenerFails() {
        BotEventDispatcher.ON_SPAWN.add((n, u) -> { throw new RuntimeException("oops"); });
        BotEventDispatcher.ON_SPAWN.add((n, u) -> { /* ok */ });

        assertDoesNotThrow(() -> BotEventDispatcher.fireSpawn("Test", UUID.randomUUID()));
    }

    @Test
    void shouldNotFireAfterListenerRemoved() {
        List<String> captured = new ArrayList<>();
        var listener = (java.util.function.BiConsumer<String, UUID>) (name, uuid) -> captured.add(name);
        BotEventDispatcher.ON_SPAWN.add(listener);
        BotEventDispatcher.ON_SPAWN.remove(listener);

        BotEventDispatcher.fireSpawn("Ghost", UUID.randomUUID());

        assertTrue(captured.isEmpty());
    }
}