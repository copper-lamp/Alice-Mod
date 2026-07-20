package io.alice.mod.adapter.ai.event.events;

import java.util.UUID;

/**
 * 假人死亡事件。
 * <p>
 * 当假人（AliceBotPlayer）死亡时触发。
 * 用于中断当前任务、触发重生逻辑等。
 */
public class BotDeathEvent {

    private final String name;
    private final UUID uuid;
    private final String deathMessage;

    public BotDeathEvent(String name, UUID uuid, String deathMessage) {
        this.name = name;
        this.uuid = uuid;
        this.deathMessage = deathMessage;
    }

    public String getName() {
        return name;
    }

    public UUID getUuid() {
        return uuid;
    }

    public String getDeathMessage() {
        return deathMessage;
    }
}