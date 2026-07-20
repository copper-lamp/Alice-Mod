package io.alice.mod.adapter.ai.tracker;

import io.alice.mod.adapter.api.service.BotHandle;
import io.alice.mod.adapter.api.service.InventoryService;
import io.alice.mod.adapter.api.types.Vec3;
import net.minecraft.core.BlockPos;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.Container;
import net.minecraft.world.SimpleContainer;
import net.minecraft.world.entity.player.Inventory;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.world.level.block.entity.ChestBlockEntity;
import net.minecraft.world.level.block.entity.FurnaceBlockEntity;
import net.minecraft.world.level.block.entity.HopperBlockEntity;
import net.minecraft.world.level.block.entity.BarrelBlockEntity;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.*;
import java.util.function.Predicate;
import java.util.stream.Collectors;

/**
 * 物品存储追踪器——监控假人背包和附近容器的物品。
 * <p>
 * 从 altoclef {@code adris.altoclef.trackers.ItemStorage} 概念移植。
 * <p>
 * 职责：
 * <ul>
 *   <li>追踪假人背包中的物品</li>
 *   <li>识别附近容器并缓存其内容</li>
 *   <li>提供物品数量查询</li>
 *   <li>提供容器位置查询</li>
 * </ul>
 */
public class ItemStorageTracker extends Tracker {

    private static final Logger LOG = LoggerFactory.getLogger(ItemStorageTracker.class);

    // ──────────────────────────────────────────────
    //  常量
    // ──────────────────────────────────────────────

    /** 容器扫描半径。 */
    private static final double CONTAINER_SCAN_RADIUS = 10.0;
    /** 容器缓存超时时间（ms）。 */
    private static final long CONTAINER_CACHE_TIMEOUT = 30000;

    // ──────────────────────────────────────────────
    //  缓存
    // ──────────────────────────────────────────────

    /** 背包物品计数：Item → 数量。 */
    private final Map<Item, Integer> inventoryCounts = new HashMap<>();

    /** 已知容器列表。 */
    private final List<ContainerCache> knownContainers = new ArrayList<>();

    /** 所有槽位的物品列表。 */
    private final List<ItemStack> allSlots = new ArrayList<>();

    private long lastInventoryScan = 0;
    private long lastContainerScan = 0;

    public ItemStorageTracker(TrackerManager manager) {
        super(manager);
    }

    // ──────────────────────────────────────────────
    //  更新
    // ──────────────────────────────────────────────

    @Override
    protected void updateState() {
        // 背包扫描（每 tick）
        scanInventory();

        // 容器扫描（间隔）
        long now = System.currentTimeMillis();
        if (now - lastContainerScan > CONTAINER_CACHE_TIMEOUT / 2) {
            scanContainers();
            lastContainerScan = now;
        }
    }

    @Override
    protected void reset() {
        inventoryCounts.clear();
        knownContainers.clear();
        allSlots.clear();
        lastInventoryScan = 0;
        lastContainerScan = 0;
    }

    // ──────────────────────────────────────────────
    //  背包查询
    // ──────────────────────────────────────────────

    /**
     * 获取背包中指定物品的数量。
     *
     * @param item 物品
     * @return 数量
     */
    public int getItemCount(Item item) {
        ensureUpdated();
        return inventoryCounts.getOrDefault(item, 0);
    }

    /**
     * 背包中是否有指定物品。
     */
    public boolean hasItem(Item item) {
        return getItemCount(item) > 0;
    }

    /**
     * 获取所有背包物品的计数。
     */
    public Map<Item, Integer> getInventoryCounts() {
        ensureUpdated();
        return new HashMap<>(inventoryCounts);
    }

    /**
     * 获取背包中满足某个条件的物品数量。
     */
    public int getItemCountIf(Predicate<Item> filter) {
        ensureUpdated();
        return inventoryCounts.entrySet().stream()
                .filter(e -> filter.test(e.getKey()))
                .mapToInt(Map.Entry::getValue)
                .sum();
    }

    /**
     * 获取背包中最佳的食物物品（用于进食）。
     */
    public Optional<Item> getBestFoodItem() {
        ensureUpdated();
        return inventoryCounts.keySet().stream()
                .filter(item -> item.components().get(net.minecraft.core.component.DataComponents.FOOD) != null)
                .max(Comparator.comparingInt(item -> 1));
    }

    /**
     * 获取背包中最佳的剑。
     */
    public Optional<Item> getBestSword() {
        ensureUpdated();
        return inventoryCounts.keySet().stream()
                .filter(item -> item instanceof net.minecraft.world.item.SwordItem)
                .max(Comparator.comparingDouble(item ->
                        4.0f));
    }

    // ──────────────────────────────────────────────
    //  容器查询
    // ──────────────────────────────────────────────

    /**
     * 获取所有已知容器。
     */
    public List<ContainerCache> getKnownContainers() {
        ensureUpdated();
        return new ArrayList<>(knownContainers);
    }

    /**
     * 获取有指定物品的容器。
     */
    public List<ContainerCache> getContainersWithItem(Item... items) {
        ensureUpdated();
        Set<Item> itemSet = new HashSet<>(Arrays.asList(items));
        return knownContainers.stream()
                .filter(c -> c.hasAnyItem(itemSet))
                .collect(Collectors.toList());
    }

    /**
     * 获取最近的容器位置。
     */
    public Optional<ContainerCache> getClosestContainer() {
        ensureUpdated();
        ServerPlayer player = getPlayer();
        if (player == null) return Optional.empty();

        Vec3 playerPos = Vec3.of(player.getX(), player.getY(), player.getZ());
        return knownContainers.stream()
                .min(Comparator.comparingDouble(c ->
                        c.position.distanceTo(playerPos)));
    }

    /**
     * 获取指定坐标的容器缓存。
     */
    public Optional<ContainerCache> getContainerAt(BlockPos pos) {
        ensureUpdated();
        Vec3 target = Vec3.of(pos.getX(), pos.getY(), pos.getZ());
        return knownContainers.stream()
                .filter(c -> c.position.equals(target))
                .findFirst();
    }

    /**
     * 是否有指定坐标的容器。
     */
    public boolean hasContainerAt(BlockPos pos) {
        return getContainerAt(pos).isPresent();
    }

    // ──────────────────────────────────────────────
    //  内部方法
    // ──────────────────────────────────────────────

    private void scanInventory() {
        inventoryCounts.clear();
        allSlots.clear();

        ServerPlayer player = getPlayer();
        if (player == null) return;

        Inventory inv = player.getInventory();
        for (int i = 0; i < inv.getContainerSize(); i++) {
            ItemStack stack = inv.getItem(i);
            if (!stack.isEmpty()) {
                Item item = stack.getItem();
                inventoryCounts.merge(item, stack.getCount(), Integer::sum);
                allSlots.add(stack);
            }
        }
    }

    private void scanContainers() {
        knownContainers.clear();
        ServerPlayer player = getPlayer();
        if (player == null) return;

        BlockPos playerPos = player.blockPosition();
        int r = (int) CONTAINER_SCAN_RADIUS;

        for (int x = -r; x <= r; x++) {
            for (int y = -r; y <= r; y++) {
                for (int z = -r; z <= r; z++) {
                    BlockPos pos = playerPos.offset(x, y, z);
                    BlockEntity be = player.serverLevel().getBlockEntity(pos);
                    if (be instanceof Container container) {
                        ContainerCache cache = new ContainerCache(
                                Vec3.of(pos.getX(), pos.getY(), pos.getZ()),
                                container
                        );
                        knownContainers.add(cache);
                    }
                }
            }
        }
    }

    private ServerPlayer getPlayer() {
        if (bot == null) return null;
        return bot.getNativePlayer();
    }

    // ──────────────────────────────────────────────
    //  ContainerCache
    // ──────────────────────────────────────────────

    /**
     * 容器缓存——记录容器的位置和物品列表。
     */
    public static class ContainerCache {
        private final Vec3 position;
        private final Container container;
        private final long timestamp;

        ContainerCache(Vec3 position, Container container) {
            this.position = position;
            this.container = container;
            this.timestamp = System.currentTimeMillis();
        }

        public Vec3 getPosition() { return position; }
        public Container getContainer() { return container; }
        public long getTimestamp() { return timestamp; }

        /**
         * 检查容器中是否有任一指定物品。
         */
        public boolean hasAnyItem(Set<Item> items) {
            for (int i = 0; i < container.getContainerSize(); i++) {
                ItemStack stack = container.getItem(i);
                if (!stack.isEmpty() && items.contains(stack.getItem())) {
                    return true;
                }
            }
            return false;
        }

        /**
         * 获取容器中指定物品的总数。
         */
        public int getItemCount(Item item) {
            int count = 0;
            for (int i = 0; i < container.getContainerSize(); i++) {
                ItemStack stack = container.getItem(i);
                if (!stack.isEmpty() && stack.getItem() == item) {
                    count += stack.getCount();
                }
            }
            return count;
        }

        @Override
        public String toString() {
            return "ContainerCache{" + position + "}";
        }
    }
}