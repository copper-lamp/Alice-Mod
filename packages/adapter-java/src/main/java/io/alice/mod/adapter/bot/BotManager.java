package io.alice.mod.adapter.bot;

import carpet.patches.EntityPlayerMPFake;
import com.mojang.authlib.GameProfile;
import io.alice.mod.adapter.world.WorldContext;
import io.alice.mod.adapter.world.WorldContextManager;
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

/**
 * 假人管理器 — 假人的全生命周期管理。
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
 * <strong>过渡期设计：</strong>
 * 正在从"静态全局单例"迁移到"世界上下文中的实例"。
 * 当前同时支持两种访问方式：
 * <ul>
 *   <li>静态方法：委托给当前活跃的 WorldContext 中的 BotManager 实例</li>
 *   <li>实例方法：通过 {@code WorldContextManager.getActive().getBotManager()} 直接调用</li>
 * </ul>
 * 未来所有静态方法将标记 {@code @Deprecated} 并最终移除。
 */
public final class BotManager {

    private static final Logger LOG = LoggerFactory.getLogger(BotManager.class);

    /** 假人名称最大长度。 */
    public static final int MAX_NAME_LENGTH = 16;

    /** 假人名称合法字符正则。 */
    public static final String NAME_PATTERN = "^[a-zA-Z0-9_]+$";

    /** 重生死亡延迟（游戏刻），约 30 秒。 */
    private static final long RESPAWN_DELAY_TICKS = 30 * 20;

    // ── 实例字段（新设计） ──

    private final MinecraftServer server;
    private final Map<UUID, EntityPlayerMPFake> bots = new ConcurrentHashMap<>();
    private final Map<String, UUID> nameIndex = new ConcurrentHashMap<>();
    private final Map<UUID, Long> pendingRespawns = new ConcurrentHashMap<>();
    private final Map<UUID, Boolean> deathHandled = new ConcurrentHashMap<>();
    private final Map<UUID, Long> createdAtMap = new ConcurrentHashMap<>();

    // ── 静态委托（过渡期） ──

    /** 当前活跃的 BotManager 实例（来自活跃的 WorldContext）。 */
    private static volatile BotManager currentInstance;

    // ── 构造 ──

    public BotManager(MinecraftServer server) {
        this.server = server;
    }

    // ── 静态委托管理（过渡期） ──

    /**
     * 设置当前活跃的 BotManager 实例。
     * 由 {@link WorldContext#initialize()} 在激活世界上下文时调用。
     */
    public static void setCurrentContext(WorldContext ctx) {
        currentInstance = ctx.getBotManager();
    }

    /** 清除当前活跃的 BotManager 实例。由 {@link WorldContext#shutdown()} 调用。 */
    public static void clearCurrentContext() {
        currentInstance = null;
    }

    /**
     * 获取当前活跃的 BotManager 实例。
     * 优先从 WorldContext 获取，兜底使用静态委托。
     */
    private static BotManager instance() {
        WorldContext ctx = WorldContextManager.getActive();
        if (ctx != null) return ctx.getBotManager();
        if (currentInstance != null) return currentInstance;
        throw new IllegalStateException("No active BotManager (no world context)");
    }

    // ── 初始化（实例方法） ──

    /** 初始化 BotManager。由 WorldContext 在激活时调用。 */
    public void init(MinecraftServer minecraftServer) {
        // server already set in constructor
        BotRepository repository = BotRepository.get(minecraftServer);
        int count = repository.size();
        LOG.info("BotManager initialized for server, {} bot entries recovered", count);
    }

    /** 服务端停止时的清理（实例方法）。 */
    public void shutdown() {
        bots.clear();
        nameIndex.clear();
        pendingRespawns.clear();
        deathHandled.clear();
        createdAtMap.clear();
        LOG.info("BotManager shut down");
    }

    // ── 静态委托方法（过渡期，保持向后兼容） ──

    /** @deprecated 使用实例方法 */
    @Deprecated
    public static void onServerStarted(MinecraftServer minecraftServer) {
        instance().init(minecraftServer);
    }

    /** @deprecated 使用实例方法 */
    @Deprecated
    public static void onServerStopped() {
        BotManager mgr = currentInstance;
        if (mgr != null) mgr.shutdown();
    }

    /** @deprecated 使用 {@code BotManager.spawn(name, level, pos)} */
    @Deprecated
    public static EntityPlayerMPFake spawn(MinecraftServer server, String name,
                                           ServerLevel level, Vec3 pos) {
        return instance().spawn(name, level, pos);
    }

    // ── 核心操作（实例方法） ──

    /**
     * 创建并生成假人。
     * 幂等性：同名的假人只会存在一个。
     */
    public synchronized EntityPlayerMPFake spawn(String name, ServerLevel level, Vec3 pos) {
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
            return respawn(existingUuid, level, pos);
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

    /** @deprecated 使用实例方法 */
    @Deprecated
    public static boolean despawn(EntityPlayerMPFake player) {
        return instance().despawnInternal(player);
    }

    private boolean despawnInternal(EntityPlayerMPFake player) {
        if (player == null) return false;
        UUID uuid = player.getUUID();
        String name = player.getName().getString();

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

        unregisterBot(player);
        player.connection.disconnect(net.minecraft.network.chat.Component.literal("Despawned"));
        BotEventDispatcher.fireDespawn(name, uuid);

        LOG.info("BotManager: despawned bot '{}' (uuid={})", name, uuid);
        return true;
    }

    /** @deprecated 使用实例方法 */
    @Deprecated
    public static boolean dismiss(UUID uuid) { return instance().dismissInternal(uuid); }

    private boolean dismissInternal(UUID uuid) {
        EntityPlayerMPFake player = bots.get(uuid);
        String name = player != null ? player.getName().getString() : "unknown";

        if (player != null) {
            unregisterBot(player);
            player.connection.disconnect(net.minecraft.network.chat.Component.literal("Dismissed"));
        }

        BotRepository.get(server).remove(uuid);
        pendingRespawns.remove(uuid);
        deathHandled.remove(uuid);
        createdAtMap.remove(uuid);
        BotEventDispatcher.fireDismiss(name, uuid);

        LOG.info("BotManager: dismissed bot '{}' (uuid={})", name, uuid);
        return true;
    }

    /** @deprecated 使用实例方法 */
    @Deprecated
    public static boolean dismissByName(String name) { return instance().dismissByNameInternal(name); }

    private boolean dismissByNameInternal(String name) {
        EntityPlayerMPFake player = findByName(name);
        if (player != null) return dismissInternal(player.getUUID());
        UUID uuid = BotRepository.get(server).findByName(name);
        if (uuid != null) {
            BotRepository.get(server).remove(uuid);
            LOG.info("BotManager: dismissed bot '{}' from registry (uuid={})", name, uuid);
            return true;
        }
        return false;
    }

    // ---- 死亡处理 ---- //

    private void onDeathInternal(EntityPlayerMPFake body) {
        MinecraftServer srv = server;
        if (srv == null) return;

        UUID uuid = body.getUUID();
        String name = body.getName().getString();
        String deathMessage = body.getCombatTracker().getDeathMessage().getString();

        BotEventDispatcher.fireDeath(name, uuid, deathMessage);
        body.setHealth(body.getMaxHealth());
        pendingRespawns.put(uuid, srv.overworld().getGameTime());

        LOG.info("BotManager: bot '{}' died: {}", name, deathMessage);
    }

    /** @deprecated 使用实例方法 */
    @Deprecated
    static void onDeath(EntityPlayerMPFake body) { instance().onDeathInternal(body); }

    /** @deprecated 使用实例方法 */
    @Deprecated
    public static EntityPlayerMPFake respawn(MinecraftServer server, UUID uuid,
                                              ServerLevel level, Vec3 pos) {
        return instance().respawn(uuid, level, pos);
    }

    private synchronized EntityPlayerMPFake respawn(UUID uuid,
                                                     @Nullable ServerLevel level,
                                                     @Nullable Vec3 pos) {
        EntityPlayerMPFake live = bots.get(uuid);
        if (live != null) return live;

        BotRepository repository = BotRepository.get(server);
        BotRepository.Entry entry = repository.find(uuid);
        if (entry == null) return null;

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

        GameProfile profile = new GameProfile(uuid, entry.name());
        EntityPlayerMPFake player = EntityPlayerMPFake.respawnFake(server, level, profile, ClientInformation.createDefault());
        FakeConnection connection = new FakeConnection();
        server.getPlayerList().placeNewPlayer(connection, player,
                CommonListenerCookie.createInitial(profile, false));

        server.getPlayerList().load(player).ifPresent(player::load);
        player.setGameMode(GameType.SURVIVAL);
        player.teleportTo(level, pos.x, pos.y, pos.z, Set.of(), player.getYRot(), player.getXRot(), false);
        player.setHealth(player.getMaxHealth());

        deathHandled.remove(uuid);
        registerBot(player);
        pendingRespawns.remove(uuid);
        BotEventDispatcher.fireRespawn(entry.name(), uuid);

        LOG.info("BotManager: respawned bot '{}' (uuid={})", entry.name(), uuid);
        return player;
    }

    // ---- Tick 驱动 ---- //

    /** 主 tick 驱动 — 在服务端主 tick 中调用。 */
    public void tick() {
        if (server == null) return;

        // 死亡检测
        for (EntityPlayerMPFake bot : bots.values()) {
            UUID uuid = bot.getUUID();
            if (!deathHandled.containsKey(uuid) && (bot.getHealth() <= 0.0f || bot.isDeadOrDying())) {
                deathHandled.put(uuid, true);
                onDeathInternal(bot);
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
                    respawn(uuid, level, null);
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
    public EntityPlayerMPFake get(UUID uuid) { return bots.get(uuid); }

    /** 根据名称查找在线假人。 */
    @Nullable
    public EntityPlayerMPFake findByName(String name) {
        UUID uuid = nameIndex.get(name);
        return uuid != null ? bots.get(uuid) : null;
    }

    /** 获取所有在线假人。 */
    public List<EntityPlayerMPFake> findAll() { return List.copyOf(bots.values()); }

    /** 获取所有已注册的假人信息（在线 + 离线）。 */
    public List<BotInfo> listAll() {
        List<BotInfo> result = new ArrayList<>();
        for (EntityPlayerMPFake bot : bots.values()) {
            UUID uuid = bot.getUUID();
            ServerLevel level = (ServerLevel) bot.level();
            result.add(new BotInfo(uuid, bot.getName().getString(), true,
                    level.dimension().location(), bot.blockPosition(),
                    bot.getHealth(), bot.getMaxHealth(), getCreatedAt(uuid)));
        }
        BotRepository repository = BotRepository.get(server);
        for (Map.Entry<UUID, BotRepository.Entry> entry : repository.all()) {
            if (!bots.containsKey(entry.getKey())) {
                BotRepository.Entry e = entry.getValue();
                result.add(new BotInfo(entry.getKey(), e.name(), false,
                        ResourceLocation.tryParse(e.dimension()),
                        new BlockPos(e.x(), e.y(), e.z()), 0, 0, e.createdAt()));
            }
        }
        return result;
    }

    /** 判断是否为假人。 */
    public boolean isBot(ServerPlayer player) { return player instanceof EntityPlayerMPFake; }

    /** 获取在线假人数量。 */
    public int onlineCount() { return bots.size(); }

    /** 获取假人创建时间。 */
    public long getCreatedAt(UUID uuid) { return createdAtMap.getOrDefault(uuid, 0L); }

    

    /** @deprecated 使用实例方法 */
    @Deprecated @Nullable
    public static IBotHandle getHandle(UUID uuid) {
        EntityPlayerMPFake player = instance().get(uuid);
        return player != null ? new BotHandleImpl(player) : null;
    }

    /** @deprecated 使用实例方法 */
    @Deprecated @Nullable
    public static IBotHandle getHandleByName(String name) {
        EntityPlayerMPFake player = instance().findByName(name);
        return player != null ? new BotHandleImpl(player) : null;
    }

    // ---- 内部方法 ---- //

    private void registerBot(EntityPlayerMPFake player) {
        UUID uuid = player.getUUID();
        String name = player.getName().getString();
        bots.put(uuid, player);
        nameIndex.put(name, uuid);
    }

    private void unregisterBot(EntityPlayerMPFake player) {
        UUID uuid = player.getUUID();
        String name = player.getName().getString();
        bots.remove(uuid);
        nameIndex.remove(name);
    }

    /** 校验假人名称合法性。 */
    public static void validateName(String name) {
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
    public record BotInfo(UUID uuid, String name, boolean online,
                          ResourceLocation dimension, BlockPos position,
                          float health, float maxHealth, long createdAt) {}

    /** IBotHandle 实现。 */
    private static class BotHandleImpl implements IBotHandle {
        private final EntityPlayerMPFake player;

        BotHandleImpl(EntityPlayerMPFake player) { this.player = player; }

        @Override public UUID uuid() { return player.getUUID(); }
        @Override public String name() { return player.getName().getString(); }
        @Override public boolean isOnline() { return true; }
        @Override public ServerPlayer getPlayer() { return player; }

        @Override
        public void teleport(double x, double y, double z, ResourceLocation dimension) {
            MinecraftServer srv = instance().server;
            ServerLevel level = srv.getLevel(
                    ResourceKey.create(net.minecraft.core.registries.Registries.DIMENSION, dimension));
            if (level != null) {
                player.teleportTo(level, x, y, z, Set.of(), player.getYRot(), player.getXRot(), false);
            }
        }

        @Override public float getHealth() { return player.getHealth(); }
        @Override public float getMaxHealth() { return player.getMaxHealth(); }
        @Override public Vec3 getPosition() { return player.position(); }
        @Override public ResourceLocation getDimension() {
            return ((ServerLevel) player.level()).dimension().location();
        }
        @Override public int getFoodLevel() { return player.getFoodData().getFoodLevel(); }
        @Override public int getExperienceLevel() { return player.experienceLevel; }
    }
}
