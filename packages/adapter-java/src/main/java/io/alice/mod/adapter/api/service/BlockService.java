package io.alice.mod.adapter.api.service;

import io.alice.mod.adapter.api.ToolResult;

/**
 * 方块操作服务。
 * <p>
 * 提供对游戏方块的操作能力。
 */
public interface BlockService {

    /** 挖掘指定位置的方块。自动选择合适工具。 */
    ToolResult mineBlock(String botNameOrUuid, int x, int y, int z, String dimension);

    /** 在指定位置放置方块。 */
    ToolResult placeBlock(String botNameOrUuid, int x, int y, int z, String blockId, String dimension);

    /** 右键交互指定位置的方块。 */
    ToolResult useBlock(String botNameOrUuid, int x, int y, int z, String dimension);

    /** 区域操作（填充/清除/破坏/矿脉）。 */
    ToolResult areaOperation(String botNameOrUuid, String mode,
                             int x1, int y1, int z1, int x2, int y2, int z2,
                             String dimension);
}
