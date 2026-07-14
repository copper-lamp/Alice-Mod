package io.alice.mod.adapter.api.event;

import java.util.Map;
import java.util.UUID;

/**
 * 假人事件。
 * <p>
 * 事件类型：BOT_SPAWNED / BOT_DESPAWNED / BOT_DISMISSED / BOT_DEATH / BOT_RESPAWNED
 */
public record BotEvent(
        String type,
        long timestamp,
        String botName,
        UUID botUuid,
        Map<String, Object> details
) implements AliceEvent {

    @Override
    public Map<String, Object> data() {
        return details;
    }

    // 事件类型常量
    public static final String SPAWNED = "BOT_SPAWNED";
    public static final String DESPAWNED = "BOT_DESPAWNED";
    public static final String DISMISSED = "BOT_DISMISSED";
    public static final String DEATH = "BOT_DEATH";
    public static final String RESPAWNED = "BOT_RESPAWNED";
}
