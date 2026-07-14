package io.alice.mod.adapter.bot;

import net.minecraft.network.protocol.game.ClientboundSetHealthPacket;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/**
 * {@link FakeConnection} 的单元测试。
 */
class FakeConnectionTest {

    @Test
    void shouldCreateFakeConnection() {
        FakeConnection conn = new FakeConnection();
        assertNotNull(conn);
    }

    @Test
    void shouldBeConnected() {
        FakeConnection conn = new FakeConnection();
        assertTrue(conn.isConnected(), "FakeConnection should always report as connected");
    }

    @Test
    void shouldNotThrowOnSend() {
        FakeConnection conn = new FakeConnection();
        // 发送包不应抛出异常
        assertDoesNotThrow(() -> conn.send(new ClientboundSetHealthPacket(20.0f, 10, 0.0f), null, false));
    }

    @Test
    void shouldNotThrowOnDisconnect() {
        FakeConnection conn = new FakeConnection();
        assertDoesNotThrow(() -> conn.disconnect(net.minecraft.network.chat.Component.literal("test")));
    }

    @Test
    void shouldNotThrowOnTick() {
        FakeConnection conn = new FakeConnection();
        assertDoesNotThrow(() -> conn.tick());
    }

    @Test
    void shouldNotThrowOnHandleDisconnection() {
        FakeConnection conn = new FakeConnection();
        assertDoesNotThrow(() -> conn.handleDisconnection());
    }

    @Test
    void shouldNotThrowOnFlushChannel() {
        FakeConnection conn = new FakeConnection();
        assertDoesNotThrow(() -> conn.flushChannel());
    }

    @Test
    void shouldNotThrowOnSetReadOnly() {
        FakeConnection conn = new FakeConnection();
        assertDoesNotThrow(() -> conn.setReadOnly());
    }

    @Test
    void shouldNotThrowOnRunOnceConnected() {
        FakeConnection conn = new FakeConnection();
        assertDoesNotThrow(() -> conn.runOnceConnected(c -> {}));
    }
}