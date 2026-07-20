package io.alice.mod.adapter.ai.behavior.task;

import io.alice.mod.adapter.ai.behavior.ITaskRequiresGrounded;
import io.alice.mod.adapter.ai.behavior.Task;
import io.alice.mod.adapter.api.service.BotHandle;
import io.alice.mod.adapter.api.types.Vec3;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.Blocks;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.*;

/**
 * 超时游荡任务——当移动卡住时作为兜底，尝试随机方向移动。
 * <p>
 * 从 altoclef {@code adris.altoclef.tasks.movement.TimeoutWanderTask} 移植。
 * <p>
 * 实现 {@link ITaskRequiresGrounded}，需要落地才能被中断。
 * <p>
 * 策略：
 * <ol>
 *   <li>尝试探索（随机方向）</li>
 *   <li>如果卡住，执行 Plan B（随机方向远离）</li>
 *   <li>如果被方块卡住，执行脱困任务</li>
 * </ol>
 */
public class TimeoutWanderTask extends Task implements ITaskRequiresGrounded {

    private static final Logger LOG = LoggerFactory.getLogger(TimeoutWanderTask.class);

    // ──────────────────────────────────────────────
    //  常量
    // ──────────────────────────────────────────────

    /** 初始游荡距离（方块）。 */
    private static final float DEFAULT_WANDER_DISTANCE = 10.0f;
    /** 最大失败次数后放弃。 */
    private static final int MAX_FAIL_COUNT = 10;
    /** 卡住方块列表。 */
    private static final Set<Block> ANNOYING_STUCK_BLOCKS = new HashSet<>(Arrays.asList(
            Blocks.VINE, Blocks.LADDER, Blocks.TALL_GRASS, Blocks.SNOW,
            Blocks.NETHER_SPROUTS, Blocks.CAVE_VINES, Blocks.CAVE_VINES_PLANT,
            Blocks.TWISTING_VINES, Blocks.TWISTING_VINES_PLANT,
            Blocks.WEEPING_VINES_PLANT, Blocks.BIG_DRIPLEAF,
            Blocks.BIG_DRIPLEAF_STEM, Blocks.SMALL_DRIPLEAF,
            Blocks.SHORT_GRASS, Blocks.FERN, Blocks.LARGE_FERN,
            Blocks.DANDELION, Blocks.POPPY, Blocks.BLUE_ORCHID,
            Blocks.ALLIUM, Blocks.AZURE_BLUET, Blocks.RED_TULIP,
            Blocks.ORANGE_TULIP, Blocks.WHITE_TULIP, Blocks.PINK_TULIP,
            Blocks.OXEYE_DAISY, Blocks.CORNFLOWER, Blocks.LILY_OF_THE_VALLEY,
            Blocks.WITHER_ROSE, Blocks.SUNFLOWER, Blocks.LILAC,
            Blocks.ROSE_BUSH, Blocks.PEONY
    ));

    // ──────────────────────────────────────────────
    //  状态
    // ──────────────────────────────────────────────

    private final float wanderDistance;
    private Vec3 origin;
    private boolean executingPlanB = false;
    private int failCounter = 0;

    // ──────────────────────────────────────────────
    //  构造
    // ──────────────────────────────────────────────

    public TimeoutWanderTask() {
        this(DEFAULT_WANDER_DISTANCE);
    }

    public TimeoutWanderTask(float distance) {
        this.wanderDistance = distance;
        setDebugState("Wander(" + distance + ")");
    }

    // ──────────────────────────────────────────────
    //  生命周期
    // ──────────────────────────────────────────────

    @Override
    protected void onStart(BotHandle bot) {
        origin = bot.position();
        executingPlanB = false;
        failCounter = 0;
        LOG.debug("TimeoutWanderTask: start at {}", origin);
    }

    @Override
    protected Task onTick(BotHandle bot) {
        ServerPlayer player = bot.getNativePlayer();
        if (player == null) return null;

        // 检查是否被方块卡住
        BlockPos stuckPos = stuckInBlock(bot, player);
        if (stuckPos != null) {
            failCounter++;
            setDebugState("Getting unstuck from block");
            // TODO: 实现脱困任务 SafeRandomShimmyTask
            // 返回一个向后走一段的任务
            // 简化为原地跳跃
            player.jumpFromGround();
            return null;
        }

        if (executingPlanB) {
            setDebugState("Plan B: Random direction");
            // 执行随机移动
            applyRandomMovement(bot, player);
        } else {
            setDebugState("Exploring");
            // 探索：朝随机方向走
            applyRandomMovement(bot, player);
        }

        // 进度检查
        Vec3 currentPos = bot.position();
        if (currentPos.distanceTo(origin) < 0.5) {
            failCounter++;
            LOG.debug("TimeoutWanderTask: failed to move, fail {}/{}", failCounter, MAX_FAIL_COUNT);
            if (!executingPlanB) {
                executingPlanB = true;
            }
        }

        return null;
    }

    @Override
    protected void onStop(BotHandle bot, Task interruptTask) {
        // 停止所有移动输入
        String stopCmd = String.format("player %s stop", bot.name());
        executeCommand(bot, stopCmd);
        LOG.debug("TimeoutWanderTask: stopped");
    }

    @Override
    public boolean isFinished(BotHandle bot) {
        // 无限游荡
        if (Float.isInfinite(wanderDistance)) return false;

        // 失败超过最大次数，放弃
        if (failCounter > MAX_FAIL_COUNT) {
            LOG.debug("TimeoutWanderTask: exceeded max failures, finishing");
            return true;
        }

        // 到达游荡距离
        Vec3 pos = bot.position();
        double dist = pos.distanceTo(origin);
        return dist > wanderDistance;
    }

    // ──────────────────────────────────────────────
    //  内部方法
    // ──────────────────────────────────────────────

    private void applyRandomMovement(BotHandle bot, ServerPlayer player) {
        // 生成随机方向并移动
        double angle = Math.random() * 2 * Math.PI;
        float yaw = (float) Math.toDegrees(angle);

        // 设置视角方向
        String lookCmd = String.format("player %s lookAt %.2f %.2f %.2f",
                bot.name(),
                player.getX() + Math.sin(angle) * 20,
                player.getY(),
                player.getZ() + Math.cos(angle) * 20);
        executeCommand(bot, lookCmd);

        // 前进
        String fwdCmd = String.format("player %s forward", bot.name());
        executeCommand(bot, fwdCmd);

        // 偶尔跳跃
        if (Math.random() < 0.1) {
            String jumpCmd = String.format("player %s jump", bot.name());
            executeCommand(bot, jumpCmd);
        }
    }

    private record BlockPos(int x, int y, int z) {}

    private BlockPos stuckInBlock(BotHandle bot, ServerPlayer player) {
        net.minecraft.core.BlockPos p = player.blockPosition();
        if (isAnnoying(bot, p)) return new BlockPos(p.getX(), p.getY(), p.getZ());
        if (isAnnoying(bot, p.above())) return new BlockPos(p.getX(), p.getY() + 1, p.getZ());

        for (net.minecraft.core.BlockPos side : new net.minecraft.core.BlockPos[]{
                p.north(), p.south(), p.east(), p.west(),
                p.above().north(), p.above().south(), p.above().east(), p.above().west()
        }) {
            if (isAnnoying(bot, side)) {
                return new BlockPos(side.getX(), side.getY(), side.getZ());
            }
        }
        return null;
    }

    private boolean isAnnoying(BotHandle bot, net.minecraft.core.BlockPos pos) {
        ServerPlayer player = bot.getNativePlayer();
        if (player == null) return false;
        Block block = player.serverLevel().getBlockState(pos).getBlock();
        return ANNOYING_STUCK_BLOCKS.contains(block);
    }

    private void executeCommand(BotHandle bot, String command) {
        ServerPlayer player = bot.getNativePlayer();
        if (player != null && player.server != null) {
            player.server.getCommands().performPrefixedCommand(
                    player.server.createCommandSourceStack(), command);
        }
    }

    @Override
    protected boolean isEqual(Task other) {
        if (other instanceof TimeoutWanderTask task) {
            if (Float.isInfinite(wanderDistance) || Float.isInfinite(task.wanderDistance)) {
                return Float.isInfinite(wanderDistance) == Float.isInfinite(task.wanderDistance);
            }
            return Math.abs(task.wanderDistance - wanderDistance) < 0.5f;
        }
        return false;
    }

    @Override
    protected String toDebugString() {
        return "Wander(" + wanderDistance + ")";
    }
}