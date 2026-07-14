package io.alice.mod.adapter.tool.service;

import io.alice.mod.adapter.api.ToolResult;
import io.alice.mod.adapter.api.service.EntityService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * {@link EntityService} 实现。
 * <p>
 * 当前为桩实现（stub），实际的实体交互逻辑将在 V7 阶段实现。
 */
public class EntityServiceImpl implements EntityService {

    private static final Logger LOG = LoggerFactory.getLogger(EntityServiceImpl.class);

    @Override
    public ToolResult interactEntity(String botNameOrUuid, String interactionType, String entityUuid) {
        LOG.warn("EntityService.interactEntity() stub called");
        return ToolResult.fail("NOT_IMPLEMENTED", "Entity interactions not yet implemented in current version");
    }

    @Override
    public ToolResult leadEntity(String botNameOrUuid, String entityUuid) {
        LOG.warn("EntityService.leadEntity() stub called");
        return ToolResult.fail("NOT_IMPLEMENTED", "Entity interactions not yet implemented in current version");
    }

    @Override
    public ToolResult unleashEntity(String botNameOrUuid, String entityUuid) {
        LOG.warn("EntityService.unleashEntity() stub called");
        return ToolResult.fail("NOT_IMPLEMENTED", "Entity interactions not yet implemented in current version");
    }
}
