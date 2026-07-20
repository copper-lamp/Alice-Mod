package io.alice.mod.adapter.ai.tracker;

import io.alice.mod.adapter.api.service.BotHandle;
import io.alice.mod.adapter.api.types.Vec3;
import net.minecraft.core.BlockPos;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.state.BlockState;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.*;
import java.util.function.Predicate;
import java.util.stream.Collectors;

/**
 * 方块追踪器——监控指定方块的位置和状态。
 * <p>
 * 从 altoclef {@code adris.altoclef.trackers.BlockTracker} 移植。
 * <p>
 * 简化版：不使用 Baritone 做异步扫描，而是直接使用世界查询。
 * 支持：
 * <ul>
 *   <li>追踪指定方块类型</li>
 *   <li>获取最近的目标方块</li>
 *   <li>范围扫描</li>
 *   <li>不可达方块黑名单</li>
 *   <li>按维度缓存</li>
 * </ul>
 */
public class BlockTracker extends Tracker {

    private static final Logger LOG = LoggerFactory.getLogger(BlockTracker.class);

    // ──────────────────────────────────────────────
    //  常量
    // ──────────────────────────────────────────────

    /** 默认扫描间隔（tick）。 */
    private static final int DEFAULT_SCAN_INTERVAL = 20; // 1 秒
    /** 默认扫描半径。 */
    private static final int DEFAULT_SCAN_RADIUS = 64;
    /** 缓存的最大方块数。 */
    private static final int MAX_CACHE_PER_BLOCK = 100;
    /** 默认不可达尝试次数。 */
    private static final int DEFAULT_UNREACHABLE_ATTEMPTS = 4;

    // ──────────────────────────────────────────────
    //  配置
    // ──────────────────────────────────────────────

    private int scanRadius = DEFAULT_SCAN_RADIUS;
    private int scanInterval = DEFAULT_SCAN_INTERVAL;

    // ──────────────────────────────────────────────
    //  状态
    // ──────────────────────────────────────────────

    /** 每个维度的方块缓存。Key = 维度名称。 */
    private final Map<String, PosCache> dimensionCaches = new HashMap<>();

    /** 正在追踪的方块及其引用计数。 */
    private final Map<Block, Integer> trackingBlocks = new HashMap<>();

    private int tickCounter = 0;

    public BlockTracker(TrackerManager manager) {
        super(manager);
    }

    // ──────────────────────────────────────────────
    //  更新
    // ──────────────────────────────────────────────

    @Override
    protected void updateState() {
        tickCounter++;
        if (tickCounter % scanInterval != 0) return;
        if (trackingBlocks.isEmpty()) return;

        ServerPlayer player = getPlayer();
        if (player == null) return;

        rescanWorld(player);
    }

    @Override
    protected void reset() {
        for (PosCache cache : dimensionCaches.values()) {
            cache.clear();
        }
        dimensionCaches.clear();
        LOG.debug("BlockTracker: reset");
    }

    // ──────────────────────────────────────────────
    //  追踪控制
    // ──────────────────────────────────────────────

    /**
     * 开始追踪指定方块。
     * 必须与 {@link #stopTracking} 成对调用。
     */
    public void trackBlock(Block... blocks) {
        for (Block block : blocks) {
            trackingBlocks.merge(block, 1, Integer::sum);
        }
        setDirty();
    }

    /**
     * 停止追踪指定方块。
     */
    public void stopTracking(Block... blocks) {
        for (Block block : blocks) {
            trackingBlocks.computeIfPresent(block, (k, v) -> {
                int newVal = v - 1;
                return newVal <= 0 ? null : newVal;
            });
        }
    }

    /**
     * 是否正在追踪指定方块。
     */
    public boolean isTracking(Block block) {
        return trackingBlocks.containsKey(block);
    }

    // ──────────────────────────────────────────────
    //  查询方法
    // ──────────────────────────────────────────────

    /**
     * 是否有找到指定方块。
     */
    public boolean anyFound(Block... blocks) {
        ensureUpdated();
        return currentCache().anyFound(blocks);
    }

    /**
     * 是否有找到指定方块（带过滤条件）。
     */
    public boolean anyFound(Predicate<BlockPos> isValidTest, Block... blocks) {
        ensureUpdated();
        return currentCache().anyFound(isValidTest, blocks);
    }

    /**
     * 获取最近的指定方块位置。
     */
    public Optional<BlockPos> getNearestTracking(Block... blocks) {
        ensureUpdated();
        ServerPlayer player = getPlayer();
        if (player == null) return Optional.empty();
        return getNearestTracking(player.blockPosition(), blocks);
    }

    /**
     * 获取最近的指定方块位置（指定搜索中心）。
     */
    public Optional<BlockPos> getNearestTracking(BlockPos center, Block... blocks) {
        ensureUpdated();
        return currentCache().getNearest(center, blocks);
    }

    /**
     * 获取所有知道的指定方块位置。
     */
    public List<BlockPos> getKnownLocations(Block... blocks) {
        ensureUpdated();
        return currentCache().getKnownLocations(blocks);
    }

    /**
     * 在指定范围内扫描并获取最近的方块。
     */
    public Optional<BlockPos> getNearestWithinRange(BlockPos center, double range, Block... blocks) {
        int minX = (int) Math.floor(center.getX() - range);
        int maxX = (int) Math.floor(center.getX() + range);
        int minY = (int) Math.floor(center.getY() - range);
        int maxY = (int) Math.floor(center.getY() + range);
        int minZ = (int) Math.floor(center.getZ() - range);
        int maxZ = (int) Math.floor(center.getZ() + range);

        double closestDistance = Double.POSITIVE_INFINITY;
        BlockPos nearest = null;

        ServerLevel world = getWorld();
        if (world == null) return Optional.empty();

        for (int x = minX; x <= maxX; x++) {
            for (int y = minY; y <= maxY; y++) {
                for (int z = minZ; z <= maxZ; z++) {
                    BlockPos check = new BlockPos(x, y, z);
                    Block b = world.getBlockState(check).getBlock();
                    for (Block type : blocks) {
                        if (type == b) {
                            double sq = check.distSqr(center);
                            if (sq < closestDistance) {
                                closestDistance = sq;
                                nearest = check;
                            }
                            break;
                        }
                    }
                }
            }
        }
        return Optional.ofNullable(nearest);
    }

    /**
     * 手动添加一个方块位置。
     */
    public void addBlock(Block block, BlockPos pos) {
        currentCache().addBlock(block, pos);
    }

    // ──────────────────────────────────────────────
    //  不可达管理
    // ──────────────────────────────────────────────

    /**
     * 标记方块为不可达。
     */
    public void requestBlockUnreachable(BlockPos pos) {
        requestBlockUnreachable(pos, DEFAULT_UNREACHABLE_ATTEMPTS);
    }

    /**
     * 标记方块为不可达（指定允许失败次数）。
     */
    public void requestBlockUnreachable(BlockPos pos, int allowedFailures) {
        currentCache().blacklistUnreachable(pos, allowedFailures);
    }

    /**
     * 检查方块是否被标记为不可达。
     */
    public boolean isUnreachable(BlockPos pos) {
        return currentCache().blockUnreachable(pos);
    }

    // ──────────────────────────────────────────────
    //  内部方法
    // ──────────────────────────────────────────────

    private void rescanWorld(ServerPlayer player) {
        Block[] blocksToScan;
        synchronized (trackingBlocks) {
            blocksToScan = trackingBlocks.keySet().toArray(new Block[0]);
        }
        if (blocksToScan.length == 0) return;

        PosCache cache = currentCache();

        // 清理无效位置
        List<BlockPos> known = cache.getKnownLocations(blocksToScan);
        for (BlockPos pos : known) {
            if (!blockIsValid(pos, blocksToScan)) {
                cache.removeBlock(pos, blocksToScan);
            }
        }

        // 范围扫描
        BlockPos playerPos = player.blockPosition();
        int r = scanRadius;
        int count = 0;

        for (int x = -r; x <= r && count < MAX_CACHE_PER_BLOCK * blocksToScan.length; x++) {
            for (int z = -r; z <= r && count < MAX_CACHE_PER_BLOCK * blocksToScan.length; z++) {
                for (int y = -4; y <= 10; y++) { // 垂直范围：从脚下 4 到头顶 10
                    BlockPos pos = playerPos.offset(x, y, z);
                    if (cache.blockUnreachable(pos)) continue;

                    BlockState state = player.serverLevel().getBlockState(pos);
                    Block block = state.getBlock();

                    for (Block target : blocksToScan) {
                        if (block == target) {
                            cache.addBlock(block, pos);
                            count++;
                            break;
                        }
                    }
                }
            }
        }

        LOG.trace("BlockTracker: rescanned, found {} blocks of {} types", count, blocksToScan.length);
    }

    private boolean blockIsValid(BlockPos pos, Block... blocks) {
        if (isUnreachable(pos)) return false;

        ServerLevel world = getWorld();
        if (world == null) return true;

        if (!world.isLoaded(pos)) return true;

        BlockState state = world.getBlockState(pos);
        for (Block block : blocks) {
            if (state.getBlock() == block) return true;
        }
        return false;
    }

    private PosCache currentCache() {
        String dimension = getDimensionName();
        return dimensionCaches.computeIfAbsent(dimension, k -> new PosCache());
    }

    private String getDimensionName() {
        ServerPlayer player = getPlayer();
        if (player == null) return "overworld";
        return player.serverLevel().dimension().location().toString();
    }

    private ServerPlayer getPlayer() {
        if (bot == null) return null;
        return bot.getNativePlayer();
    }

    private ServerLevel getWorld() {
        ServerPlayer player = getPlayer();
        return player != null ? player.serverLevel() : null;
    }

    // ──────────────────────────────────────────────
    //  配置
    // ──────────────────────────────────────────────

    public void setScanRadius(int radius) {
        this.scanRadius = radius;
    }

    public void setScanInterval(int intervalTicks) {
        this.scanInterval = intervalTicks;
    }

    // ──────────────────────────────────────────────
    //  PosCache
    // ──────────────────────────────────────────────

    static class PosCache {
        private final Map<Block, List<BlockPos>> cachedBlocks = new HashMap<>();
        private final Map<BlockPos, Block> cachedByPosition = new HashMap<>();
        private final Map<BlockPos, UnreachableInfo> blacklist = new HashMap<>();

        public boolean anyFound(Block... blocks) {
            for (Block block : blocks) {
                if (cachedBlocks.containsKey(block)) return true;
            }
            return false;
        }

        public boolean anyFound(Predicate<BlockPos> isValidTest, Block... blocks) {
            for (Block block : blocks) {
                List<BlockPos> list = cachedBlocks.get(block);
                if (list != null) {
                    for (BlockPos pos : list) {
                        if (isValidTest.test(pos)) return true;
                    }
                }
            }
            return false;
        }

        public List<BlockPos> getKnownLocations(Block... blocks) {
            List<BlockPos> result = new ArrayList<>();
            for (Block block : blocks) {
                List<BlockPos> found = cachedBlocks.get(block);
                if (found != null) result.addAll(found);
            }
            return result;
        }

        public void removeBlock(BlockPos pos, Block... blocks) {
            for (Block block : blocks) {
                List<BlockPos> list = cachedBlocks.get(block);
                if (list != null) {
                    list.remove(pos);
                    cachedByPosition.remove(pos);
                    if (list.isEmpty()) cachedBlocks.remove(block);
                }
            }
        }

        public void addBlock(Block block, BlockPos pos) {
            if (blockUnreachable(pos)) return;
            if (cachedByPosition.containsKey(pos)) {
                if (cachedByPosition.get(pos) == block) return;
                removeBlock(pos, block);
            }
            cachedBlocks.computeIfAbsent(block, k -> new ArrayList<>()).add(pos);
            cachedByPosition.put(pos, block);
        }

        public Optional<BlockPos> getNearest(BlockPos center, Block... blocks) {
            if (!anyFound(blocks)) return Optional.empty();

            BlockPos closest = null;
            double minDist = Double.POSITIVE_INFINITY;

            for (Block block : blocks) {
                List<BlockPos> list = cachedBlocks.get(block);
                if (list == null) continue;

                for (BlockPos pos : list) {
                    double dist = pos.distSqr(center);
                    if (dist < minDist) {
                        minDist = dist;
                        closest = pos;
                    }
                }
            }
            return Optional.ofNullable(closest);
        }

        public void blacklistUnreachable(BlockPos pos, int allowedFailures) {
            UnreachableInfo info = blacklist.get(pos);
            if (info == null) {
                blacklist.put(pos, new UnreachableInfo(1, allowedFailures));
            } else {
                info.failures++;
            }
        }

        public boolean blockUnreachable(BlockPos pos) {
            UnreachableInfo info = blacklist.get(pos);
            return info != null && info.failures >= info.allowedAttempts;
        }

        public void clear() {
            cachedBlocks.clear();
            cachedByPosition.clear();
            blacklist.clear();
        }
    }

    private static class UnreachableInfo {
        int failures;
        final int allowedAttempts;

        UnreachableInfo(int failures, int allowedAttempts) {
            this.failures = failures;
            this.allowedAttempts = allowedAttempts;
        }
    }
}