package io.alice.mod.adapter.ai.tracker;

import io.alice.mod.adapter.api.service.BotHandle;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.Mob;
import net.minecraft.world.entity.monster.Monster;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.entity.animal.Animal;
import net.minecraft.world.entity.item.ItemEntity;
import net.minecraft.world.item.ItemStack;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.*;
import java.util.function.Predicate;
import java.util.stream.Collectors;

/**
 * 实体追踪器——监控附近实体的位置和状态。
 * <p>
 * 从 altoclef {@code adris.altoclef.trackers.EntityTracker} 概念移植。
 * <p>
 * 职责：
 * <ul>
 *   <li>扫描附近实体并分类缓存</li>
 *   <li>提供敌对生物检测</li>
 *   <li>提供掉落物检测</li>
 *   <li>提供附近的动物/玩家检测</li>
 *   <li>提供最近实体查询</li>
 * </ul>
 */
public class EntityTracker extends Tracker {

    private static final Logger LOG = LoggerFactory.getLogger(EntityTracker.class);

    // ──────────────────────────────────────────────
    //  常量
    // ──────────────────────────────────────────────

    /** 默认扫描半径（方块）。 */
    private static final double DEFAULT_SCAN_RADIUS = 48.0;
    /** 实体分类缓存超时（ms）。 */
    private static final long CACHE_TIMEOUT = 5000;

    // ──────────────────────────────────────────────
    //  缓存
    // ──────────────────────────────────────────────

    /** 所有附近实体的缓存。 */
    private final List<Entity> nearbyEntities = new ArrayList<>();
    private final List<Monster> hostileEntities = new ArrayList<>();
    private final List<Animal> animalEntities = new ArrayList<>();
    private final List<Player> playerEntities = new ArrayList<>();
    private final List<ItemEntity> itemEntities = new ArrayList<>();

    /** 敌对实体活跃计时器。 */
    private final Map<UUID, HostileInfo> hostileTimers = new HashMap<>();

    private long lastScanTime = 0;
    private double scanRadius = DEFAULT_SCAN_RADIUS;

    public EntityTracker(TrackerManager manager) {
        super(manager);
    }

    // ──────────────────────────────────────────────
    //  更新
    // ──────────────────────────────────────────────

    @Override
    protected void updateState() {
        clearCache();
        ServerPlayer player = getPlayer();
        if (player == null) return;

        // 扫描附近实体
        List<Entity> all = player.serverLevel().getEntities().getAll()
                .stream()
                .filter(e -> e != player && e.distanceTo(player) < scanRadius)
                .collect(Collectors.toList());

        for (Entity entity : all) {
            nearbyEntities.add(entity);

            if (entity instanceof Monster monster) {
                hostileEntities.add(monster);
                updateHostileTimer(monster);
            } else if (entity instanceof Animal animal) {
                animalEntities.add(animal);
            } else if (entity instanceof Player p) {
                playerEntities.add(p);
            } else if (entity instanceof ItemEntity item) {
                itemEntities.add(item);
            }
        }

        // 清理过期计时器
        long now = System.currentTimeMillis();
        hostileTimers.entrySet().removeIf(e ->
                now - e.getValue().lastSeenTime > CACHE_TIMEOUT || !e.getValue().alive);

        lastScanTime = now;
    }

    @Override
    protected void reset() {
        clearCache();
        hostileTimers.clear();
        lastScanTime = 0;
    }

    // ──────────────────────────────────────────────
    //  敌对实体查询
    // ──────────────────────────────────────────────

    /**
     * 获取所有敌对实体。
     */
    public List<Monster> getHostileEntities() {
        ensureUpdated();
        return new ArrayList<>(hostileEntities);
    }

    /**
     * 是否有敌对实体在范围内。
     */
    public boolean hasHostiles() {
        ensureUpdated();
        return !hostileEntities.isEmpty();
    }

    /**
     * 获取最近的敌对实体。
     */
    public Optional<Monster> getClosestHostile() {
        ensureUpdated();
        ServerPlayer player = getPlayer();
        if (player == null) return Optional.empty();

        return hostileEntities.stream()
                .min(Comparator.comparingDouble(e -> e.distanceToSqr(player)));
    }

    /**
     * 获取指定范围内是否有敌对实体。
     *
     * @param range 检测范围（方块）
     */
    public boolean hasHostilesWithin(double range) {
        ensureUpdated();
        ServerPlayer player = getPlayer();
        if (player == null) return false;

        double rangeSq = range * range;
        return hostileEntities.stream().anyMatch(e -> e.distanceToSqr(player) < rangeSq);
    }

    /**
     * 获取敌对实体在范围内持续的时间（ms）。
     *
     * @param range 检测范围
     * @return 敌对实体存在的最长时间（ms），没有则返回 0
     */
    public long getHostileDuration(double range) {
        ensureUpdated();
        ServerPlayer player = getPlayer();
        if (player == null) return 0;

        long now = System.currentTimeMillis();
        return hostileTimers.values().stream()
                .filter(info -> info.alive)
                .mapToLong(info -> now - info.firstSeenTime)
                .max()
                .orElse(0);
    }

    // ──────────────────────────────────────────────
    //  掉落物查询
    // ──────────────────────────────────────────────

    /**
     * 是否有指定物品掉落在地上。
     */
    public boolean isItemDropped(ItemStack item) {
        ensureUpdated();
        return itemEntities.stream().anyMatch(e -> e.getItem().getItem() == item.getItem());
    }

    /**
     * 获取最近的指定物品掉落物。
     */
    public Optional<ItemEntity> getClosestItemDrop(ItemStack item) {
        ensureUpdated();
        ServerPlayer player = getPlayer();
        if (player == null) return Optional.empty();

        return itemEntities.stream()
                .filter(e -> e.getItem().getItem() == item.getItem())
                .min(Comparator.comparingDouble(e -> e.distanceToSqr(player)));
    }

    /**
     * 获取所有掉落物。
     */
    public List<ItemEntity> getItemDrops() {
        ensureUpdated();
        return new ArrayList<>(itemEntities);
    }

    // ──────────────────────────────────────────────
    //  动物/玩家查询
    // ──────────────────────────────────────────────

    /**
     * 获取附近的动物。
     */
    public List<Animal> getAnimals() {
        ensureUpdated();
        return new ArrayList<>(animalEntities);
    }

    /**
     * 获取附近的玩家。
     */
    public List<Player> getPlayers() {
        ensureUpdated();
        return new ArrayList<>(playerEntities);
    }

    /**
     * 获取附近的实体（按类型）。
     */
    @SuppressWarnings("unchecked")
    public <T extends Entity> List<T> getEntitiesByType(Predicate<Entity> filter) {
        ensureUpdated();
        return (List<T>) nearbyEntities.stream()
                .filter(filter)
                .collect(Collectors.toList());
    }

    // ──────────────────────────────────────────────
    //  通用查询
    // ──────────────────────────────────────────────

    /**
     * 获取所有附近实体。
     */
    public List<Entity> getAllNearby() {
        ensureUpdated();
        return new ArrayList<>(nearbyEntities);
    }

    /**
     * 获取最近的目标实体。
     */
    public Optional<Entity> getClosestEntity(Predicate<Entity> filter) {
        ensureUpdated();
        ServerPlayer player = getPlayer();
        if (player == null) return Optional.empty();

        return nearbyEntities.stream()
                .filter(filter)
                .min(Comparator.comparingDouble(e -> e.distanceToSqr(player)));
    }

    /**
     * 设置扫描半径。
     */
    public void setScanRadius(double radius) {
        this.scanRadius = radius;
        setDirty();
    }

    // ──────────────────────────────────────────────
    //  内部方法
    // ──────────────────────────────────────────────

    private void clearCache() {
        nearbyEntities.clear();
        hostileEntities.clear();
        animalEntities.clear();
        playerEntities.clear();
        itemEntities.clear();
    }

    private void updateHostileTimer(Monster monster) {
        UUID uuid = monster.getUUID();
        long now = System.currentTimeMillis();
        HostileInfo info = hostileTimers.get(uuid);
        if (info == null) {
            hostileTimers.put(uuid, new HostileInfo(now, now, true));
        } else {
            info.lastSeenTime = now;
            info.alive = monster.isAlive();
        }
    }

    private ServerPlayer getPlayer() {
        if (bot == null) return null;
        return bot.getNativePlayer();
    }

    // ──────────────────────────────────────────────
    //  内部数据结构
    // ──────────────────────────────────────────────

    private static class HostileInfo {
        final long firstSeenTime;
        long lastSeenTime;
        boolean alive;

        HostileInfo(long firstSeenTime, long lastSeenTime, boolean alive) {
            this.firstSeenTime = firstSeenTime;
            this.lastSeenTime = lastSeenTime;
            this.alive = alive;
        }
    }
}