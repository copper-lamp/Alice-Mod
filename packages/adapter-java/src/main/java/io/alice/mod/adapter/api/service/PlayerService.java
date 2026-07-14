package io.alice.mod.adapter.api.service;

import io.alice.mod.adapter.api.types.InventorySnapshot;
import io.alice.mod.adapter.api.types.ItemStackInfo;
import io.alice.mod.adapter.api.types.Vec3;

import java.util.List;

/**
 * 玩家状态服务。
 * <p>
 * 提供对假人/玩家状态的查询能力。
 */
public interface PlayerService {

    /** 获取指定假人的血量。 */
    float getHealth(String botNameOrUuid);

    /** 获取指定假人的饥饿值（0-20）。 */
    int getFoodLevel(String botNameOrUuid);

    /** 获取指定假人的位置。 */
    Vec3 getPosition(String botNameOrUuid);

    /** 获取指定假人的经验等级。 */
    int getExperienceLevel(String botNameOrUuid);

    /** 获取指定假人背包信息。 */
    InventorySnapshot getInventory(String botNameOrUuid);

    /** 获取指定假人装备。 */
    List<ItemStackInfo> getEquipment(String botNameOrUuid);

    /** 获取指定假人的游戏模式（如 "survival"、"creative"）。 */
    String getGameMode(String botNameOrUuid);
}
