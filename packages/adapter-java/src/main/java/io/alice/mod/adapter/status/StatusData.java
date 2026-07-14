package io.alice.mod.adapter.status;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;

import java.time.Instant;
import java.util.List;

/**
 * 状态上报数据模型。
 * <p>
 * 按照通信协议规范定义状态数据结构，序列化为 Agent Core 可识别的格式。
 */
public record StatusData(
        double health,
        double maxHealth,
        int food,
        int maxFood,
        float saturation,
        int air,
        int maxAir,
        double x,
        double y,
        double z,
        String dimension,
        float yaw,
        float pitch,
        int armor,
        int armorToughness,
        String mainhand,
        String offhand,
        String helmet,
        String chestplate,
        String leggings,
        String boots,
        int usedSlots,
        int totalSlots,
        List<ItemEntry> items,
        List<StatusEffect> effects,
        long time,
        String weather,
        String difficulty,
        String gameMode
) {

    /** 背包物品摘要。 */
    public record ItemEntry(String name, int count) {}

    /** 状态效果。 */
    public record StatusEffect(String id, int amplifier, int duration) {}

    /**
     * 序列化为 JSON-RPC 通知消息的 params。
     *
     * @return 符合通信协议规范的 status_report params
     */
    public JsonObject toJson() {
        JsonObject root = new JsonObject();

        root.addProperty("timestamp", Instant.now().toString());

        // health
        JsonObject healthObj = new JsonObject();
        healthObj.addProperty("health", health);
        healthObj.addProperty("max_health", maxHealth);
        healthObj.addProperty("hunger", food);
        healthObj.addProperty("max_hunger", maxFood);
        healthObj.addProperty("saturation", saturation);
        healthObj.addProperty("air", air);
        healthObj.addProperty("max_air", maxAir);
        root.add("health", healthObj);

        // position
        JsonObject posObj = new JsonObject();
        posObj.addProperty("x", x);
        posObj.addProperty("y", y);
        posObj.addProperty("z", z);
        posObj.addProperty("dimension", dimension);
        posObj.addProperty("yaw", yaw);
        posObj.addProperty("pitch", pitch);
        root.add("position", posObj);

        // defense
        JsonObject defObj = new JsonObject();
        defObj.addProperty("armor", armor);
        defObj.addProperty("armor_toughness", armorToughness);
        root.add("defense", defObj);

        // equipment
        JsonObject equipObj = new JsonObject();
        equipObj.addProperty("mainhand", mainhand);
        equipObj.addProperty("offhand", offhand);
        equipObj.addProperty("helmet", helmet);
        equipObj.addProperty("chestplate", chestplate);
        equipObj.addProperty("leggings", leggings);
        equipObj.addProperty("boots", boots);
        root.add("equipment", equipObj);

        // inventory summary
        JsonObject invObj = new JsonObject();
        invObj.addProperty("used_slots", usedSlots);
        invObj.addProperty("total_slots", totalSlots);
        invObj.addProperty("item_count", items != null ? items.size() : 0);
        if (items != null && !items.isEmpty()) {
            JsonArray itemsArray = new JsonArray();
            for (ItemEntry item : items) {
                JsonObject itemObj = new JsonObject();
                itemObj.addProperty("name", item.name());
                itemObj.addProperty("count", item.count());
                itemsArray.add(itemObj);
            }
            invObj.add("items", itemsArray);
        }
        root.add("inventory_summary", invObj);

        // status effects
        if (effects != null && !effects.isEmpty()) {
            JsonArray effectsArray = new JsonArray();
            for (StatusEffect effect : effects) {
                JsonObject effectObj = new JsonObject();
                effectObj.addProperty("id", effect.id());
                effectObj.addProperty("amplifier", effect.amplifier());
                effectObj.addProperty("duration", effect.duration());
                effectsArray.add(effectObj);
            }
            root.add("status_effects", effectsArray);
        } else {
            root.add("status_effects", new JsonArray());
        }

        // world info
        JsonObject worldObj = new JsonObject();
        worldObj.addProperty("time", time);
        worldObj.addProperty("weather", weather);
        worldObj.addProperty("difficulty", difficulty);
        worldObj.addProperty("game_mode", gameMode);
        root.add("world_info", worldObj);

        return root;
    }
}
