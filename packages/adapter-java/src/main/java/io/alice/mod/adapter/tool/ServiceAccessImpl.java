package io.alice.mod.adapter.tool;

import io.alice.mod.adapter.api.service.*;
import io.alice.mod.adapter.tool.service.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * {@link AliceServiceAccess} 实现。
 * <p>
 * 封装 Alice Mod 内部模块的调用，向附属模组暴露受限的服务接口。
 * 每个服务实现类都桥接到 Alice Mod 的底层模块（BotManager、BotAccess 等）。
 */
public class ServiceAccessImpl implements AliceServiceAccess {

    private static final Logger LOG = LoggerFactory.getLogger(ServiceAccessImpl.class);

    private static final String API_VERSION = "1.0.0";

    private final BotService botService;
    private final WorldService worldService;
    private final PathfindingService pathfindingService;
    private final PlayerService playerService;
    private final InventoryService inventoryService;
    private final EventService eventService;
    private final BlockService blockService;
    private final EntityService entityService;
    private final TcpService tcpService;

    public ServiceAccessImpl() {
        this.botService = new BotServiceImpl();
        this.worldService = new WorldServiceImpl();
        this.pathfindingService = new PathfindingServiceImpl();
        this.playerService = new PlayerServiceImpl();
        this.inventoryService = new InventoryServiceImpl();
        this.eventService = new EventServiceImpl();
        this.blockService = new BlockServiceImpl();
        this.entityService = new EntityServiceImpl();
        this.tcpService = new TcpServiceImpl();

        LOG.debug("ServiceAccessImpl initialized (version {})", API_VERSION);
    }

    @Override
    public String apiVersion() {
        return API_VERSION;
    }

    @Override
    public BotService botService() { return botService; }

    @Override
    public WorldService worldService() { return worldService; }

    @Override
    public PathfindingService pathfindingService() { return pathfindingService; }

    @Override
    public PlayerService playerService() { return playerService; }

    @Override
    public InventoryService inventoryService() { return inventoryService; }

    @Override
    public EventService eventService() { return eventService; }

    @Override
    public BlockService blockService() { return blockService; }

    @Override
    public EntityService entityService() { return entityService; }

    @Override
    public TcpService tcpService() { return tcpService; }
}
