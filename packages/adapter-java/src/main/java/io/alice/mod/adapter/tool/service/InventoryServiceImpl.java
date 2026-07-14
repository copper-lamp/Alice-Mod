package io.alice.mod.adapter.tool.service;

import io.alice.mod.adapter.api.ToolResult;
import io.alice.mod.adapter.api.service.InventoryService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * {@link InventoryService} 实现。
 * <p>
 * 当前为桩实现（stub），实际的背包操作逻辑将在 V5 阶段实现。
 */
public class InventoryServiceImpl implements InventoryService {

    private static final Logger LOG = LoggerFactory.getLogger(InventoryServiceImpl.class);

    @Override
    public ToolResult dropItem(String botNameOrUuid, int slot, int count) {
        LOG.warn("InventoryService.dropItem() stub called");
        return ToolResult.fail("NOT_IMPLEMENTED", "Inventory operations not yet implemented in current version");
    }

    @Override
    public ToolResult takeFromContainer(String botNameOrUuid, String containerPos, String itemId, int count) {
        LOG.warn("InventoryService.takeFromContainer() stub called");
        return ToolResult.fail("NOT_IMPLEMENTED", "Inventory operations not yet implemented in current version");
    }

    @Override
    public ToolResult putToContainer(String botNameOrUuid, String containerPos, String itemId, int count) {
        LOG.warn("InventoryService.putToContainer() stub called");
        return ToolResult.fail("NOT_IMPLEMENTED", "Inventory operations not yet implemented in current version");
    }

    @Override
    public ToolResult equipItem(String botNameOrUuid, String itemId, String slot) {
        LOG.warn("InventoryService.equipItem() stub called");
        return ToolResult.fail("NOT_IMPLEMENTED", "Inventory operations not yet implemented in current version");
    }

    @Override
    public int countItem(String botNameOrUuid, String itemId) {
        return 0;
    }
}
