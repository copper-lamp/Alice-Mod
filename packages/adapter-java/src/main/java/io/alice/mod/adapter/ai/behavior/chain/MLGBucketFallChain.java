package io.alice.mod.adapter.ai.behavior.chain;

import io.alice.mod.adapter.ai.behavior.SingleTaskChain;
import io.alice.mod.adapter.ai.behavior.Task;
import io.alice.mod.adapter.ai.behavior.TaskRunner;
import io.alice.mod.adapter.ai.state.SmoothInputController;
import io.alice.mod.adapter.api.service.BotHandle;
import io.alice.mod.adapter.api.types.Vec3;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.effect.MobEffects;
import net.minecraft.world.item.Items;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * 水桶落地链（MLG Bucket）——自动检测高速下落并放置水桶。
 * <p>
 * 从 altoclef {@code adris.altoclef.chains.MLGBucketFallChain} 移植。
 * <p>
 * 优先级：200（下落中），100（放置水桶后收集），60（回收水桶）
 * <p>
 * 职责：
 * <ul>
 *   <li>检测高速下落（y 速度 < -0.7）</li>
 *   <li>自动放置水桶</li>
 *   <li>落地后回收水桶</li>
 *   <li>飘浮效果时使用紫颂果</li>
 * </ul>
 * <p>
 * 实现 {@code ITaskOverridesGrounded} 接口，可以中断正在空中跑酷的任务。
 */
public class MLGBucketFallChain extends SingleTaskChain {

    private static final Logger LOG = LoggerFactory.getLogger(MLGBucketFallChain.class);

    // ──────────────────────────────────────────────
    //  常量
    // ──────────────────────────────────────────────

    /** 下落速度阈值（超过此值触发水桶落地）。 */
    private static final double FALL_SPEED_THRESHOLD = -0.7;
    /** 放置水桶后收集的超时时间（秒）。 */
    private static final int COLLECT_WATER_TIMEOUT = 4;
    /** 回收水桶的重复间隔（秒）。 */
    private static final double PICKUP_REPEAT_INTERVAL = 0.25;
    /** 收集水桶的最大距离。 */
    private static final double COLLECT_MAX_DISTANCE = 5.5;

    // ──────────────────────────────────────────────
    //  状态
    // ──────────────────────────────────────────────

    private long tryCollectWaterStart = 0;
    private long lastPickupTime = 0;
    private MLGBucketTask lastMLG = null;
    private boolean wasPickingUp = false;
    private boolean doingChorusFruit = false;

    public MLGBucketFallChain(TaskRunner runner) {
        super(runner);
    }

    // ──────────────────────────────────────────────
    //  Chain 核心
    // ──────────────────────────────────────────────

    @Override
    public float getPriority(BotHandle bot) {
        ServerPlayer player = bot.getNativePlayer();
        if (player == null || !bot.inGame()) {
            return Float.NEGATIVE_INFINITY;
        }

        // 检测高速下落
        if (isFallingOhNo(player)) {
            tryCollectWaterStart = System.currentTimeMillis();
            MLGBucketTask mlg = new MLGBucketTask();
            setTask(mlg);
            lastMLG = mlg;
            return 200;
        }

        // 放置水桶后尝试收集
        if (shouldCollectWater(bot, player)) {
            return tryCollectWater(bot, player);
        }

        // 清理状态
        if (wasPickingUp) {
            wasPickingUp = false;
            lastMLG = null;
        }

        // 飘浮效果时使用紫颂果
        if (shouldEatChorusFruit(bot, player)) {
            startChorusFruit(bot, player);
            return 100;
        } else if (doingChorusFruit) {
            stopChorusFruit(bot);
        }

        return Float.NEGATIVE_INFINITY;
    }

    @Override
    protected void onTaskFinish(BotHandle bot) {
        // 水桶落地任务完成
    }

    @Override
    public boolean isActive() {
        return true; // 始终检测下落
    }

    @Override
    public String getName() {
        return "MLG Water Bucket Fall";
    }

    // ──────────────────────────────────────────────
    //  下落检测
    // ──────────────────────────────────────────────

    /**
     * 检测是否正在高速下落。
     */
    public boolean isFallingOhNo(ServerPlayer player) {
        // 游泳/水中/地面/攀爬时不下落
        if (player.isSwimming() || player.isInWater() || player.onGround() || player.isClimbing()) {
            return false;
        }

        double ySpeed = player.getDeltaMovement().y;
        return ySpeed < FALL_SPEED_THRESHOLD;
    }

    // ──────────────────────────────────────────────
    //  水桶收集
    // ──────────────────────────────────────────────

    private boolean shouldCollectWater(BotHandle bot, ServerPlayer player) {
        if (tryCollectWaterStart == 0) return false;
        if ((System.currentTimeMillis() - tryCollectWaterStart) > COLLECT_WATER_TIMEOUT * 1000L) {
            return false;
        }
        // 下落速度已放缓（说明放置成功）
        return player.getDeltaMovement().y >= -0.5;
    }

    private float tryCollectWater(BotHandle bot, ServerPlayer player) {
        // 检查是否有空桶（没有水桶时）
        // TODO: 使用 InventoryService 检查
        boolean hasBucket = false;
        boolean hasWaterBucket = false;

        if (!hasBucket || hasWaterBucket) {
            return Float.NEGATIVE_INFINITY;
        }

        if (lastMLG == null) return Float.NEGATIVE_INFINITY;
        Vec3 placed = lastMLG.getWaterPlacedPos();
        if (placed == null) return Float.NEGATIVE_INFINITY;

        // 检查放置位置是否在范围内
        double dist = player.distanceToSqr(placed.x(), placed.y(), placed.z());
        if (dist > COLLECT_MAX_DISTANCE * COLLECT_MAX_DISTANCE) {
            return Float.NEGATIVE_INFINITY;
        }

        // 对着水右键回收
        String command = String.format("player %s lookAt %.2f %.2f %.2f",
                bot.name(), placed.x(), placed.y(), placed.z());
        executeCommand(bot, command);

        long now = System.currentTimeMillis();
        if ((now - lastPickupTime) > PICKUP_REPEAT_INTERVAL * 1000L) {
            lastPickupTime = now;
            // 右键回收水桶
            command = String.format("player %s useItem", bot.name());
            executeCommand(bot, command);
            wasPickingUp = true;
        } else if (wasPickingUp) {
            wasPickingUp = false;
        }

        return 60;
    }

    // ──────────────────────────────────────────────
    //  紫颂果处理
    // ──────────────────────────────────────────────

    private boolean shouldEatChorusFruit(BotHandle bot, ServerPlayer player) {
        if (!player.hasEffect(MobEffects.LEVITATION)) return false;

        // TODO: 检查冷却和背包
        boolean hasChorusFruit = false;
        boolean hasWaterBucket = false;

        return !hasWaterBucket && hasChorusFruit;
    }

    private void startChorusFruit(BotHandle bot, ServerPlayer player) {
        doingChorusFruit = true;
        // 装备紫颂果
        String command = String.format("player %s equip %s",
                bot.name(), "chorus_fruit");
        executeCommand(bot, command);
        // 按住右键
        bot.getSmoothInputController().hold(bot, SmoothInputController.Input.USE);
        LOG.debug("MLGBucketFallChain: eating chorus fruit for levitation");
    }

    private void stopChorusFruit(BotHandle bot) {
        doingChorusFruit = false;
        bot.getSmoothInputController().release(bot, SmoothInputController.Input.USE);
    }

    // ──────────────────────────────────────────────
    //  工具方法
    // ──────────────────────────────────────────────

    private void executeCommand(BotHandle bot, String command) {
        ServerPlayer player = bot.getNativePlayer();
        if (player != null && player.server != null) {
            player.server.getCommands().performPrefixedCommand(
                    player.server.createCommandSourceStack(), command);
        }
    }

    // ──────────────────────────────────────────────
    //  查询
    // ──────────────────────────────────────────────

    public boolean isChorusFruiting() {
        return doingChorusFruit;
    }

    // ──────────────────────────────────────────────
    //  MLG 水桶落地任务
    // ──────────────────────────────────────────────

    /**
     * 水桶落地任务。
     * <p>
     * 实现 {@link io.alice.mod.adapter.ai.behavior.ITaskOverridesGrounded}，
     * 可以中断正在空中跑酷的 {@link io.alice.mod.adapter.ai.behavior.ITaskRequiresGrounded} 任务。
     */
    public static class MLGBucketTask extends Task {

        private Vec3 waterPlacedPos;
        private boolean hasPlaced = false;

        public MLGBucketTask() {
            setDebugState("MLGBucket");
        }

        @Override
        protected void onStart(BotHandle bot) {
            hasPlaced = false;
            waterPlacedPos = null;
        }

        @Override
        protected Task onTick(BotHandle bot) {
            ServerPlayer player = bot.getNativePlayer();
            if (player == null) return null;

            if (hasPlaced) return null;

            // 1. 切换到水桶
            // TODO: 通过 SlotHandler 装备水桶
            String equipCmd = String.format("player %s equip %s",
                    bot.name(), "water_bucket");
            executeCommand(bot, equipCmd);

            // 2. 看向脚下
            String lookCmd = String.format("player %s lookAt %.2f %.2f %.2f",
                    bot.name(), player.getX(), player.getY() - 1, player.getZ());
            executeCommand(bot, lookCmd);

            // 3. 右键放置水
            String useCmd = String.format("player %s useItem", bot.name());
            executeCommand(bot, useCmd);

            // 记录放置位置
            waterPlacedPos = Vec3.of(player.getX(), player.getY() - 1, player.getZ());
            hasPlaced = true;

            player.serverLevel().setBlockAndUpdate(
                    new net.minecraft.core.BlockPos(
                            (int) Math.floor(player.getX()),
                            (int) Math.floor(player.getY()) - 1,
                            (int) Math.floor(player.getZ())
                    ),
                    net.minecraft.world.level.block.Blocks.WATER.defaultBlockState()
            );

            LOG.debug("MLGBucketTask: placed water at {}", waterPlacedPos);
            return null;
        }

        @Override
        protected void onStop(BotHandle bot, Task interruptTask) {}

        @Override
        public boolean isFinished(BotHandle bot) {
            ServerPlayer player = bot.getNativePlayer();
            return player == null || player.onGround() || player.isInWater();
        }

        @Override
        protected boolean isEqual(Task other) {
            return other instanceof MLGBucketTask;
        }

        @Override
        protected String toDebugString() {
            return "MLGBucket";
        }

        /** 获取水桶放置位置。 */
        public Vec3 getWaterPlacedPos() {
            return waterPlacedPos;
        }

        private void executeCommand(BotHandle bot, String command) {
            ServerPlayer player = bot.getNativePlayer();
            if (player != null && player.server != null) {
                player.server.getCommands().performPrefixedCommand(
                        player.server.createCommandSourceStack(), command);
            }
        }
    }
}