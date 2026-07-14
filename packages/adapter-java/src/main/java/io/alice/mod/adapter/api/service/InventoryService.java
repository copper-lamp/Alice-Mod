package io.alice.mod.adapter.api.service;

import io.alice.mod.adapter.api.ToolResult;

import java.util.Map;

/**
 * 背包操作服务。
 * <p>
 * 提供对假人背包的读写操作。
 */
public interface InventoryService {

    /** 从指定槽位丢弃物品。 */
    ToolResult dropItem(String botNameOrUuid, int slot, int count);

    /** 从容器中取出物品放入假人背包。 */
    ToolResult takeFromContainer(String botNameOrUuid, String containerPos, String itemId, int count);

    /** 将物品从假人背包放入容器。 */
    ToolResult putToContainer(String botNameOrUuid, String containerPos, String itemId, int count);

    /** 装备物品到指定槽位。 */
    ToolResult equipItem(String botNameOrUuid, String itemId, String slot);

    /** 搜索假人背包中指定物品的数量。 */
    int countItem(String botNameOrUuid, String itemId);
}
