package io.alice.mod.adapter.api.service;

import io.alice.mod.adapter.api.ToolResult;

/**
 * 实体交互服务。
 * <p>
 * 提供对游戏实体的交互能力。
 */
public interface EntityService {

    /** 交互实体（喂食/繁殖/交易/驯服/剪毛/挤奶等）。 */
    ToolResult interactEntity(String botNameOrUuid, String interactionType, String entityUuid);

    /** 拴绳实体。 */
    ToolResult leadEntity(String botNameOrUuid, String entityUuid);

    /** 释放拴绳实体。 */
    ToolResult unleashEntity(String botNameOrUuid, String entityUuid);
}
