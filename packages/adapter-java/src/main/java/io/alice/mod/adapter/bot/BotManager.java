package io.alice.mod.adapter.bot;

import carpet.patches.EntityPlayerMPFake;
import com.mojang.authlib.GameProfile;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.Registries;
import net.minecraft.resources.ResourceKey;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ClientInformation;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.network.CommonListenerCookie;
import net.minecraft.world.level.GameType;
import net.minecraft.world.level.Level;
import net.minecraft.world.phys.Vec3;
import org.jetbrains.annotations.Nullable;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;

/**
 * 假人管理器 — 全局单例，负责假人的全生命周期管理。
 * <p>
 * 职责：
 * <ul>
 *   <li>假人的创建（{@link #spawn}）、休眠（{@link #despawn}）、销毁（{@link #dismiss}）</li>
 *   <li>死亡检测与自动重生</li>
 *   <li>在线假人索引维护</li>
 *   <li>与 {@link BotRepository} 协作完成持久化</li>
 *   <li>服务端重启后恢复假人注册表</li>
 * </ul>
 * <p>
 * 设计为静态单例模式，方便工具层和事件系统直接访问。
 */
public final class BotManager {

    private static final Logger LOG = LoggerFactory.getLogger(BotManager.class);

    /** 假人名称最大长度。 */
    public static final int MAX_NAME_LENGTH = 16;

    /** 假人名称合法字符正则。 */
    public static final String NAME_PATTERN = "^[a-zA-Z0-9_]+$";

    /** 重生死延迟（游戏刻），约 30 秒。 */
    private static final long RESPAWN_DELAY_TICKS = 30 * 20;

    /** 在线假人映射：UUID → EntityPlayerMPFake。 */
    private static final Map<UUID, EntityPlayerMPFake> bots = new ConcurrentHashMap<>();

    /** 名称索引：名称 → UUID。 */
    private static final Map<String, UUID> nameIndex = new ConcurrentHashMap<>();

    /** 等待重生的假人：UUID → 死亡时的游戏刻。 */
    private static final Map<UUID, Long> pendingRespawns = new ConcurrentHashMap<>();

    /** 死亡标记跟踪：防止重复处理死亡。 */
    private static final Map<UUID, Boolean> deathHandled = new ConcurrentHashMap<>();

    /** 假人创建时间戳：UUID → 创建时间（毫秒）。 */
    private static final Map<UUID, Long> createdAtMap = new ConcurrentHashMap<>();

    /** MinecraftServer 实例引用。 */
    private static MinecraftServer server;

    private BotManager() {}

    // ---- 初始化 ---- //

    /**
     * 设置 MinecraftServer 实例。
     * 在服务端启动时由 {@link io.alice.mod.adapter.AliceModAdapter} 调用。
     */
    public static void init(MinecraftServer minecraftServer) {
        server = minecraftServer;
        LOG.info("BotManager initialized");
    }

    /**
     * 服务端启动完成后的回调。
     * 从注册表恢复已知的假人信息（不自动上线）。
     */
    public static void onServerStarted(MinecraftServer minecraftServer) {
        server = minecraftServer;
        BotRepository repository = BotRepository.get(server);
        int count = repository.size();
        LOG.info("BotManager: recovered {} bot entries from repository", count);
    }

    /**
     * 服务端停止时的清理。
     */
    public static void onServerStopped() {
        bots.clear();
        nameIndex.clear();
        pendingRespawns.clear();
        deathHandled.clear();
        createdAtMap.clear();
        server = null;
        LOG.info("BotManager: cleared all bot data");
    }

    // ---- 核心操作 ---- //

    /**
     * 创建并生成假人。
     * <p>
     * 幂等性：同名的假人只会存在一个 — 如果已在线则返回在线实例；
     * 如果已注册但离线则唤醒；如果不存在则创建新实例。
     *
     * @param server MinecraftServer 实例
     * @param name   假人名称（仅限字母数字和下划线，最长 16 字符）
     * @param level  目标维度
     * @param pos    生成位置
     * @return 假人实例
     * @throws IllegalArgumentException 名称非法时抛出
     */
    public static synchronized EntityPlayerMPFake spawn(MinecraftServer server,
                                                         String name,
                                                         ServerLevel level,
                                                         Vec3 pos) {
        validateName(name);

        // 检查是否已在线
        EntityPlayerMPFake existing = findByName(name);
        if (existing != null) {
            LOG.debug("BotManager: bot '{}' is already online, returning existing", name);
            return existing;
        }

        // 检查注册表中是否有同名假人（休眠状态）
        BotRepository repository = BotRepository.get(server);
        UUID existingUuid = repository.findByName(name);
        if (existingUuid != null) {
            return respawn(server, existingUuid, level, pos);
        }

        // 创建全新假人
        UUID uuid = UUID.randomUUID();
        GameProfile profile = new GameProfile(uuid, name);
        EntityPlayerMPFake player = EntityPlayerMPFake.respawnFake(server, level, profile, ClientInformation.createDefault());
        FakeConnection connection = new FakeConnection();
        server.getPlayerList().placeNewPlayer(connection, player,
                CommonListenerCookie.createInitial(profile, false));

        // 恢复玩家数据（如果存在 .dat 存档）
        server.getPlayerList().load(player).ifPresent(player::load);

        // 强制设置为生存模式
        player.setGameMode(GameType.SURVIVAL);

        // 传送到目标位置
        player.teleportTo(level, pos.x, pos.y, pos.z, Set.of(), player.getYRot(), player.getXRot(), false);
        player.setHealth(player.getMaxHealth());

        // 记录创建时间
        createdAtMap.put(uuid, System.currentTimeMillis());

        // 注册到索引
        registerBot(player);

        // 持久化注册表
        BlockPos blockPos = player.blockPosition();
        repository.put(uuid, new BotEntry(name, level.dimension().location(), blockPos));
        repository.setDirty();

        // 触发事件
        BotEventDispatcher.fireSpawn(name, uuid);

        LOG.info("BotManager: spawned bot '{}' (uuid={}) at [{}, {}, {}] in {}",
                name, uuid, pos.x, pos.y, pos.z, level.dimension().location());
        return player;
    }

    /**
     * 休眠假人：保存存档后从游戏世界移除，不删除注册信息。
     *
     * @param player 假人实例
     * @return true 如果成功下线
     */
    public static boolean despawn(EntityPlayerMPFake player) {
        if (player == null) return false;
        UUID uuid = player.getUUID();
        String name = player.getName().getString();

        // 更新注册表中的位置信息
        BotRepository repository = BotRepository.get(server);
        BotRepository.Entry entry = repository.find(uuid);
        if (entry != null) {
            ServerLevel currentLevel = (ServerLevel) player.level();
            BlockPos currentPos = player.blockPosition();
            repository.put(uuid, new BotEntry(
                    entry.name(),
                    currentLevel.dimension().location(),
                    currentPos,
                    entry.createdAt()
            ));
        }

        // 移除假人
        unregisterBot(player);
        player.connection.disconnect(net.minecraft.network.chat.Component.literal("Despawned"));

        // 触发事件
        BotEventDispatcher.fireDespawn(name, uuid);

        LOG.info("BotManager: despawned bot '{}' (uuid={})", name, uuid);
        return true;
    }

    /**
     * 永久销毁假人：下线并删除注册信息。
     *
     * @param uuid 假人 UUID
     * @return true 如果成功销毁
     */
    public static boolean dismiss(UUID uuid) {
        EntityPlayerMPFake player = bots.get(uuid);
        String name = player != null ? player.getName().getString() : "unknown";

        if (player != null) {
            unregisterBot(player);
            player.connection.disconnect(net.minecraft.network.chat.Component.literal("Dismissed"));
        }

        // 从注册表移除
        BotRepository.get(server).remove(uuid);
        pendingRespawns.remove(uuid);
        deathHandled.remove(uuid);
        createdAtMap.remove(uuid);

        // 触发事件
        BotEventDispatcher.fireDismiss(name, uuid);

        LOG.info("BotManager: dismissed bot '{}' (uuid={})", name, uuid);
        return true;
    }

    /**
     * 永久销毁假人（按名称）。
     *
     * @param name 假人名称
     * @return true 如果成功销毁
     */
    public static boolean dismissByName(String name) {
        EntityPlayerMPFake player = findByName(name);
        if (player != null) {
            return dismiss(player.getUUID());
        }
        UUID uuid = BotRepository.get(server).findByName(name);
        if (uuid != null) {
            BotRepository.get(server).remove(uuid);
            LOG.info("BotManager: dismissed bot '{}' from registry (uuid={})", name, uuid);
            return true;
        }
        return false;
    }

    // ---- 死亡处理 ---- //

    /**
     * 假人死亡回调（由 {@link #tick()} 检测到死亡后调用）。
     */
    static void onDeath(EntityPlayerMPFake body) {
        MinecraftServer srv = server;
        if (srv == null) return;

        UUID uuid = body.getUUID();
        String name = body.getName().getString();
        String deathMessage = body.getCombatTracker().getDeathMessage().getString();

        // 触发事件
        BotEventDispatcher.fireDeath(name, uuid, deathMessage);

        // 补满血量以保证 .dat 存档完整
        body.setHealth(body.getMaxHealth());

        // 记录死亡时间，用于重生计时
        pendingRespawns.put(uuid, srv.overworld().getGameTime());

        LOG.info("BotManager: bot '{}' died: {}", name, deathMessage);
    }

    /**
     * 重生一个假人（从休眠或死亡状态恢复）。
     *
     * @param server MinecraftServer
     * @param uuid   假人 UUID
     * @param level  目标维度（为 null 时使用注册表中记录的维度）
     * @param pos    目标位置（为 null 时使用注册表中记录的位置）
     * @return 假人实例，或 null（如果注册表中不存在该 UUID）
     */
    @Nullable
    public static synchronized EntityPlayerMPFake respawn(MinecraftServer server,
                                                           UUID uuid,
                                                           @Nullable ServerLevel level,
                                                           @Nullable Vec3 pos) {
        // 如果已在线，直接返回
        EntityPlayerMPFake live = bots.get(uuid);
        if (live != null) return live;

        // 查注册表
        BotRepository repository = BotRepository.get(server);
        BotRepository.Entry entry = repository.find(uuid);
        if (entry == null) return null;

        // 确定维度和位置
        if (level == null) {
            ResourceLocation dimId = ResourceLocation.tryParse(entry.dimension());
            if (dimId != null) {
                level = server.getLevel(ResourceKey.create(Registries.DIMENSION, dimId));
            }
            if (level == null) level = server.overworld();
        }
        if (pos == null) {
            pos = new Vec3(entry.x() + 0.5, entry.y(), entry.z() + 0.5);
        }

        // 创建假人
        GameProfile profile = new GameProfile(uuid, entry.name());
        EntityPlayerMPFake player = EntityPlayerMPFake.respawnFake(server, level, profile, ClientInformation.createDefault());
        FakeConnection connection = new FakeConnection();
        server.getPlayerList().placeNewPlayer(connection, player,
                CommonListenerCookie.createInitial(profile, false));

        // 恢复玩家数据
        server.getPlayerList().load(player).ifPresent(player::load);

        // 强制设置为生存模式
        player.setGameMode(GameType.SURVIVAL);

        // 传送
        player.teleportTo(level, pos.x, pos.y, pos.z, Set.of(), player.getYRot(), player.getXRot(), false);
        player.setHealth(player.getMaxHealth());

        // 重置死亡标记
        deathHandled.remove(uuid);

        // 注册到索引
        registerBot(player);

        // 清除重生等待状态
        pendingRespawns.remove(uuid);

        // 触发事件
        BotEventDispatcher.fireRespawn(entry.name(), uuid);

        LOG.info("BotManager: respawned bot '{}' (uuid={})", entry.name(), uuid);
        return player;
    }

    // ---- Tick 驱动 ---- //

    /**
     * 主 tick 驱动 — 在服务端主 tick 中调用。
     * <p>
     * 当前负责：
     * <ul>
     *   <li>死亡检测（遍历在线假人，检测血量 ≤ 0 或 isDeadOrDying）</li>
     *   <li>死亡假人的定时重生检查</li>
     * </ul>
     */
    public static void tick() {
        if (server == null) return;

        // 死亡检测
        for (EntityPlayerMPFake bot : bots.values()) {
            UUID uuid = bot.getUUID();
            if (!deathHandled.containsKey(uuid) && (bot.getHealth() <= 0.0f || bot.isDeadOrDying())) {
                deathHandled.put(uuid, true);
                onDeath(bot);
            }
        }

        // 重生检查
        if (pendingRespawns.isEmpty()) return;
        long now = server.overworld().getGameTime();
        List<UUID> ready = new ArrayList<>();

        for (Map.Entry<UUID, Long> entry : pendingRespawns.entrySet()) {
            if (now - entry.getValue() >= RESPAWN_DELAY_TICKS) {
                ready.add(entry.getKey());
            }
        }

        for (UUID uuid : ready) {
            try {
                BotRepository.Entry repoEntry = BotRepository.get(server).find(uuid);
                if (repoEntry != null) {
                    ServerLevel level = server.overworld();
                    ResourceLocation dimId = ResourceLocation.tryParse(repoEntry.dimension());
                    if (dimId != null) {
                        ServerLevel dimLevel = server.getLevel(
                                ResourceKey.create(Registries.DIMENSION, dimId));
                        if (dimLevel != null) level = dimLevel;
                    }
                    respawn(server, uuid, level, null);
                } else {
                    pendingRespawns.remove(uuid);
                }
            } catch (Exception e) {
                LOG.warn("BotManager: failed to respawn bot {}", uuid, e);
                pendingRespawns.remove(uuid);
            }
        }
    }

    // ---- 查询 ---- //

    /** 根据 UUID 查找在线假人。 */
    @Nullable
    public static EntityPlayerMPFake get(UUID uuid) {
        return bots.get(uuid);
    }

    /** 根据名称查找在线假人。 */
    @Nullable
    public static EntityPlayerMPFake findByName(String name) {
        UUID uuid = nameIndex.get(name);
        return uuid != null ? bots.get(uuid) : null;
    }

    /** 获取所有在线假人。 */
    public static List<EntityPlayerMPFake> findAll() {
        return List.copyOf(bots.values());
    }

    /** 获取所有已注册的假人信息（在线 + 离线）。 */
    public static List<BotInfo> listAll() {
        List<BotInfo> result = new ArrayList<>();

        // 在线假人
        for (EntityPlayerMPFake bot : bots.values()) {
            UUID uuid = bot.getUUID();
            ServerLevel level = (ServerLevel) bot.level();
            result.add(new BotInfo(
                    uuid,
                    bot.getName().getString(),
                    true,
                    level.dimension().location(),
                    bot.blockPosition(),
                    bot.getHealth(),
                    bot.getMaxHealth(),
                    getCreatedAt(uuid)
            ));
        }

        // 离线假人（注册表中存在但不在线）
        BotRepository repository = BotRepository.get(server);
        for (Map.Entry<UUID, BotRepository.Entry> entry : repository.all()) {
            if (!bots.containsKey(entry.getKey())) {
                BotRepository.Entry e = entry.getValue();
                result.add(new BotInfo(
                        entry.getKey(),
                        e.name(),
                        false,
                        ResourceLocation.tryParse(e.dimension()),
                        new BlockPos(e.x(), e.y(), e.z()),
                        0, 0,
                        e.createdAt()
                ));
            }
        }

        return result;
    }

    /** 判断是否为假人。 */
    public static boolean isBot(ServerPlayer player) {
        return player instanceof EntityPlayerMPFake;
    }

    /** 获取在线假人数量。 */
    public static int onlineCount() {
        return bots.size();
    }

    /** 获取假人创建时间。 */
    public static long getCreatedAt(UUID uuid) {
        return createdAtMap.getOrDefault(uuid, 0L);
    }

    /** 获取 {@link IBotHandle} 实例。 */
    @Nullable
    public static IBotHandle getHandle(UUID uuid) {
        EntityPlayerMPFake player = bots.get(uuid);
        return player != null ? new BotHandleImpl(player) : null;
    }

    @Nullable
    public static IBotHandle getHandleByName(String name) {
        EntityPlayerMPFake player = findByName(name);
        return player != null ? new BotHandleImpl(player) : null;
    }

    // ---- 内部方法 ---- //

    /** 注册假人到索引。 */
    private static void registerBot(EntityPlayerMPFake player) {
        UUID uuid = player.getUUID();
        String name = player.getName().getString();
        bots.put(uuid, player);
        nameIndex.put(name, uuid);
    }

    /** 从索引中移除假人。 */
    private static void unregisterBot(EntityPlayerMPFake player) {
        UUID uuid = player.getUUID();
        String name = player.getName().getString();
        bots.remove(uuid);
        nameIndex.remove(name);
    }

    /** 校验假人名称合法性。 */
    static void validateName(String name) {
        if (name == null || name.isEmpty()) {
            throw new IllegalArgumentException("Bot name cannot be empty");
        }
        if (name.length() > MAX_NAME_LENGTH) {
            throw new IllegalArgumentException("Bot name too long (max " + MAX_NAME_LENGTH + " chars): " + name);
        }
        if (!name.matches(NAME_PATTERN)) {
            throw new IllegalArgumentException("Bot name contains invalid characters (allowed: a-z, A-Z, 0-9, _): " + name);
        }
    }

    // ---- 内部类 ---- //

    /** 假人信息（用于列表查询）。 */
    public record BotInfo(
            UUID uuid,
            String name,
            boolean online,
            ResourceLocation dimension,
            BlockPos position,
            float health,
            float maxHealth,
            long createdAt
    ) {}

    /** IBotHandle 实现。 */
    private static class BotHandleImpl implements IBotHandle {

        private final EntityPlayerMPFake player;

        BotHandleImpl(EntityPlayerMPFake player) {
            this.player = player;
        }

        @Override
        public UUID uuid() { return player.getUUID(); }

        @Override
        public String name() { return player.getName().getString(); }

        @Override
        public boolean isOnline() { return true; }

        @Override
        public ServerPlayer getPlayer() { return player; }

        @Override
        public void teleport(double x, double y, double z, ResourceLocation dimension) {
            ServerLevel level = server.getLevel(
                    ResourceKey.create(net.minecraft.core.registries.Registries.DIMENSION, dimension));
            if (level != null) {
                player.teleportTo(level, x, y, z, Set.of(), player.getYRot(), player.getXRot(), false);
            }
        }

        @Override
        public float getHealth() { return player.getHealth(); }

        @Override
        public float getMaxHealth() { return player.getMaxHealth(); }

        @Override
        public Vec3 getPosition() { return player.position(); }

        @Override
        public ResourceLocation getDimension() {
            return ((ServerLevel) player.level()).dimension().location();
        }

        @Override
        public int getFoodLevel() { return player.getFoodData().getFoodLevel(); }

        @Override
        public int getExperienceLevel() { return player.experienceLevel; }
    }
}