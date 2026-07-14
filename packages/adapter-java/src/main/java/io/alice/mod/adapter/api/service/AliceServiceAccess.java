package io.alice.mod.adapter.api.service;

/**
 * Alice Mod 服务访问入口。
 * <p>
 * 附属模组通过此接口获取 Alice Mod 的各类服务。
 * 每个服务接口的方法都必须是线程安全的（Alice Mod 保证）。
 */
public interface AliceServiceAccess {

    /** 返回 API 版本。遵循语义化版本（如 "1.0.0"）。 */
    String apiVersion();

    /** 假人管理服务（假人创建/销毁/查询）。 */
    BotService botService();

    /** 游戏世界服务（方块查询/设置、实体查询）。 */
    WorldService worldService();

    /** 寻路服务（路径计算）。 */
    PathfindingService pathfindingService();

    /** 玩家状态服务（血量/饥饿/经验等）。 */
    PlayerService playerService();

    /** 背包操作服务。 */
    InventoryService inventoryService();

    /** 事件订阅服务。 */
    EventService eventService();

    /** 方块操作服务。 */
    BlockService blockService();

    /** 实体交互服务。 */
    EntityService entityService();

    /** TCP 通信服务。 */
    TcpService tcpService();
}
