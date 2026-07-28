package io.alice.mod.adapter.world;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class WorldContextToolGateTest {

    @Test
    void stateAndLifecycleToolsRemainAvailableWhileDead() {
        assertFalse(WorldContext.requiresLiveBot("bot_info"));
        assertFalse(WorldContext.requiresLiveBot("bot_list"));
        assertFalse(WorldContext.requiresLiveBot("bot_despawn"));
        assertFalse(WorldContext.requiresLiveBot("bot_dismiss"));
    }

    @Test
    void adapterActionToolsRequireAliveBot() {
        assertTrue(WorldContext.requiresLiveBot("move_to"));
        assertTrue(WorldContext.requiresLiveBot("mine_block"));
        assertTrue(WorldContext.requiresLiveBot("chat"));
        assertTrue(WorldContext.requiresLiveBot("look_around"));
    }
}
