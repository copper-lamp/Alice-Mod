package io.alice.mod.adapter.tool.service;

import io.alice.mod.adapter.api.ToolResult;
import io.alice.mod.adapter.api.service.BlockService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * {@link BlockService} 实现。
 * <p>
 * 当前为桩实现（stub），实际的方块操作逻辑将在 V6 阶段实现。
 */
public class BlockServiceImpl implements BlockService {

    private static final Logger LOG = LoggerFactory.getLogger(BlockServiceImpl.class);

    @Override
    public ToolResult mineBlock(String botNameOrUuid, int x, int y, int z, String dimension) {
        LOG.warn("BlockService.mineBlock() stub called");
        return ToolResult.fail("NOT_IMPLEMENTED", "Block operations not yet implemented in current version");
    }

    @Override
    public ToolResult placeBlock(String botNameOrUuid, int x, int y, int z, String blockId, String dimension) {
        LOG.warn("BlockService.placeBlock() stub called");
        return ToolResult.fail("NOT_IMPLEMENTED", "Block operations not yet implemented in current version");
    }

    @Override
    public ToolResult useBlock(String botNameOrUuid, int x, int y, int z, String dimension) {
        LOG.warn("BlockService.useBlock() stub called");
        return ToolResult.fail("NOT_IMPLEMENTED", "Block operations not yet implemented in current version");
    }

    @Override
    public ToolResult areaOperation(String botNameOrUuid, String mode,
                                     int x1, int y1, int z1, int x2, int y2, int z2,
                                     String dimension) {
        LOG.warn("BlockService.areaOperation() stub called");
        return ToolResult.fail("NOT_IMPLEMENTED", "Block operations not yet implemented in current version");
    }
}
