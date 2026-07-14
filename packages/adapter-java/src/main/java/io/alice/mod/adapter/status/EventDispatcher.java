package io.alice.mod.adapter.status;

import com.google.gson.JsonObject;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.time.Instant;
import java.util.function.Consumer;

/**
 * 事件通知分发器。
 * <p>
 * 当游戏内发生重要事件（被攻击、死亡、聊天等）时，
 * 通过此分发器组装事件通知并推送到 Agent Core。
 */
public final class EventDispatcher {

    private static final Logger LOG = LoggerFactory.getLogger(EventDispatcher.class);

    private final Consumer<JsonObject> sender;

    public EventDispatcher(Consumer<JsonObject> sender) {
        this.sender = sender;
    }

    /**
     * 发送事件通知。
     *
     * @param eventType 事件类型（如 "entity_attack", "death", "player_chat"）
     * @param severity  严重度（"info", "warning", "danger"）
     * @param data      事件数据
     */
    public void dispatch(String eventType, String severity, JsonObject data) {
        JsonObject event = new JsonObject();
        event.addProperty("event_type", eventType);
        event.addProperty("severity", severity);
        event.addProperty("timestamp", Instant.now().toString());
        event.add("data", data);

        sender.accept(event);
        LOG.debug("Event dispatched: type={}, severity={}", eventType, severity);
    }

    // ---- 便捷方法 ----

    /** 被实体攻击。 */
    public void onEntityAttack(String attackerType, String attackerId, double distance, float damage, float healthAfter) {
        JsonObject data = new JsonObject();
        JsonObject attacker = new JsonObject();
        attacker.addProperty("type", attackerType);
        attacker.addProperty("id", attackerId);
        attacker.addProperty("distance", distance);
        data.add("attacker", attacker);
        data.addProperty("damage", damage);
        data.addProperty("health_after", healthAfter);
        dispatch("entity_attack", "warning", data);
    }

    /** 血量过低。 */
    public void onHealthLow(double current, double max) {
        JsonObject data = new JsonObject();
        data.addProperty("health", current);
        data.addProperty("max_health", max);
        dispatch("health_low", "danger", data);
    }

    /** 玩家死亡。 */
    public void onDeath(String deathMessage) {
        JsonObject data = new JsonObject();
        data.addProperty("message", deathMessage);
        dispatch("death", "danger", data);
    }

    /** 玩家聊天。 */
    public void onPlayerChat(String playerName, String message) {
        JsonObject data = new JsonObject();
        data.addProperty("player", playerName);
        data.addProperty("message", message);
        dispatch("player_chat", "info", data);
    }

    /** 背包已满。 */
    public void onInventoryFull() {
        dispatch("inventory_full", "info", new JsonObject());
    }
}
