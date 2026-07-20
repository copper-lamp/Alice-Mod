package io.alice.mod.adapter.ai.behavior.chain;

import io.alice.mod.adapter.ai.behavior.SingleTaskChain;
import io.alice.mod.adapter.ai.behavior.Task;
import io.alice.mod.adapter.ai.behavior.TaskRunner;
import io.alice.mod.adapter.ai.state.SmoothInputController;
import io.alice.mod.adapter.api.service.BotHandle;
import io.alice.mod.adapter.api.types.Vec3;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.effect.MobEffects;
import net.minecraft.world.item.Items;
import net.minecraft.world.level.block.AbstractFireBlock;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.Blocks;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * 世界生存链——处理环境危险。
 * <p>
 * 从 altoclef {@code adris.altoclef.chains.WorldSurvivalChain} 移植。
 * <p>
 * 优先级：100（熔岩/火），90（灭火），60（传送门卡住/回收水）
 * <p>
 * 职责：
 * <ul>
 *   <li>熔岩逃生（最高优先级）</li>
 *   <li>火中逃生并灭火</li>
 *   <li>用水桶自灭</li>
 *   <li>传送门卡住自救</li>
 *   <li>防止溺水</li>
 * </ul>
 */
public class WorldSurvivalChain extends SingleTaskChain {

    private static final Logger LOG = LoggerFactory.getLogger(WorldSurvivalChain.class);

    // ──────────────────────────────────────────────
    //  状态
    // ──────────────────────────────────────────────

    private long lastLavaTime = 0;
    private boolean wasAvoidingDrowning = false;
    private long portalStuckStart = 0;
    private BlockPos extinguishWaterPos;

    public WorldSurvivalChain(TaskRunner runner) {
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

        // 防止溺水
        handleDrowning(bot, player);

        // 熔岩逃生（最高优先级）
        if (isInLavaOhShit(bot, player)) {
            setTask(new EscapeLavaTask());
            return 100;
        }

        // 火中逃生
        if (isInFire(player)) {
            setTask(new EscapeFireTask());
            return 100;
        }

        // 用水桶自灭
        if (tryExtinguishWithWater(bot, player)) {
            return 90;
        }

        // 回收水桶
        if (tryPickupWater(bot, player)) {
            return 60;
        }

        // 传送门卡住自救
        if (isStuckInPortal(bot, player)) {
            setTask(new PortalEscapeTask());
            return 60;
        }

        return Float.NEGATIVE_INFINITY;
    }

    @Override
    protected void onTaskFinish(BotHandle bot) {
        // 任务完成
    }

    @Override
    public boolean isActive() {
        return true; // 始终检查生存状态
    }

    @Override
    public String getName() {
        return "Misc World Survival";
    }

    @Override
    protected void onStop(BotHandle bot) {
        super.onStop(bot);
    }

    // ──────────────────────────────────────────────
    //  溺水处理
    // ──────────────────────────────────────────────

    private void handleDrowning(BotHandle bot, ServerPlayer player) {
        boolean avoided = false;
        if (player.isUnderWater() && player.getAirSupply() < player.getMaxAir()) {
            // 向上游
            bot.getSmoothInputController().hold(bot, SmoothInputController.Input.JUMP);
            avoided = true;
            wasAvoidingDrowning = true;
        }

        // 停止向上游
        if (wasAvoidingDrowning && !avoided) {
            wasAvoidingDrowning = false;
            bot.getSmoothInputController().release(bot, SmoothInputController.Input.JUMP);
        }
    }

    // ──────────────────────────────────────────────
    //  熔岩/火检测
    // ──────────────────────────────────────────────

    private boolean isInLavaOhShit(BotHandle bot, ServerPlayer player) {
        if (player.isInLava() && !player.hasEffect(MobEffects.FIRE_RESISTANCE)) {
            lastLavaTime = System.currentTimeMillis();
            return true;
        }
        // 离开熔岩后 1 秒内仍然视为危险
        return player.isOnFire() && (System.currentTimeMillis() - lastLavaTime) < 1000;
    }

    private boolean isInFire(ServerPlayer player) {
        if (!player.isOnFire() || player.hasEffect(MobEffects.FIRE_RESISTANCE)) {
            return false;
        }
        // 检查玩家周围是否有火方块
        for (BlockPos pos : getBlocksTouchingPlayer(player)) {
            Block b = player.serverLevel().getBlockState(pos).getBlock();
            if (b instanceof AbstractFireBlock) {
                return true;
            }
        }
        return false;
    }

    // ──────────────────────────────────────────────
    //  灭火
    // ──────────────────────────────────────────────

    private boolean tryExtinguishWithWater(BotHandle bot, ServerPlayer player) {
        if (!player.isOnFire() || player.hasEffect(MobEffects.FIRE_RESISTANCE)) {
            extinguishWaterPos = null;
            return false;
        }

        // 检查是否有水桶
        // TODO: 使用 InventoryService 检查
        boolean hasWaterBucket = false;
        if (!hasWaterBucket) return false;

        BlockPos targetPos = player.blockPosition();
        BlockPos downPos = targetPos.below();

        // 检查下方是否能放置水
        if (canPlaceBlock(player, downPos)) {
            // 放置水桶
            String command = String.format("player %s placeBlock %d %d %d",
                    bot.name(), downPos.getX(), downPos.getY(), downPos.getZ());
            executeCommand(bot, command);
            extinguishWaterPos = targetPos;
            return true;
        }

        // 没有位置放水，找水源
        setTask(new FindWaterTask());
        return true;
    }

    private boolean tryPickupWater(BotHandle bot, ServerPlayer player) {
        if (extinguishWaterPos == null) return false;

        // 检查是否还有水（在之前放置的位置）
        BlockPos waterPos = extinguishWaterPos;
        Block block = player.serverLevel().getBlockState(waterPos).getBlock();
        if (block == Blocks.WATER) {
            // 回收水桶
            String command = String.format("player %s useItem", bot.name());
            executeCommand(bot, command);
            extinguishWaterPos = null;
            return true;
        }

        extinguishWaterPos = null;
        return false;
    }

    // ──────────────────────────────────────────────
    //  传送门卡住
    // ──────────────────────────────────────────────

    private boolean isStuckInPortal(BotHandle bot, ServerPlayer player) {
        // 检查是否在传送门内
        if (player.level().getBlockState(player.blockPosition()).getBlock() == Blocks.NETHER_PORTAL) {
            if (portalStuckStart == 0) {
                portalStuckStart = System.currentTimeMillis();
            }
            // 卡住超过 5 秒
            return (System.currentTimeMillis() - portalStuckStart) > 5000;
        } else {
            portalStuckStart = 0;
            // 暂停交互（Baritone 兼容）
            // bot.getBaritoneSettings().setInteractionPaused(false);
            return false;
        }
    }

    // ──────────────────────────────────────────────
    //  工具方法
    // ──────────────────────────────────────────────

    private BlockPos[] getBlocksTouchingPlayer(ServerPlayer player) {
        BlockPos p = player.blockPosition();
        return new BlockPos[]{
                p, p.above(),
                p.north(), p.south(), p.east(), p.west(),
                p.north().east(), p.north().west(), p.south().east(), p.south().west()
        };
    }

    private boolean canPlaceBlock(ServerPlayer player, BlockPos pos) {
        return player.serverLevel().getBlockState(pos).isAir();
    }

    private void executeCommand(BotHandle bot, String command) {
        ServerPlayer player = bot.getNativePlayer();
        if (player != null && player.server != null) {
            player.server.getCommands().performPrefixedCommand(
                    player.server.createCommandSourceStack(), command);
        }
    }

    // ──────────────────────────────────────────────
    //  内部任务
    // ──────────────────────────────────────────────

    private static class EscapeLavaTask extends Task {
        EscapeLavaTask() { setDebugState("EscapeLava"); }

        @Override
        protected void onStart(BotHandle bot) {}

        @Override
        protected Task onTick(BotHandle bot) {
            // TODO: 实现熔岩逃生逻辑（寻找最近安全位置）
            return null;
        }

        @Override
        protected void onStop(BotHandle bot, Task interruptTask) {}

        @Override
        public boolean isFinished(BotHandle bot) {
            ServerPlayer player = bot.getNativePlayer();
            return player == null || (!player.isInLava() && !player.isOnFire());
        }

        @Override
        protected boolean isEqual(Task other) { return other instanceof EscapeLavaTask; }

        @Override
        protected String toDebugString() { return "EscapeLava"; }
    }

    private static class EscapeFireTask extends Task {
        EscapeFireTask() { setDebugState("EscapeFire"); }

        @Override
        protected void onStart(BotHandle bot) {}

        @Override
        protected Task onTick(BotHandle bot) { return null; }

        @Override
        protected void onStop(BotHandle bot, Task interruptTask) {}

        @Override
        public boolean isFinished(BotHandle bot) {
            ServerPlayer player = bot.getNativePlayer();
            return player == null || !player.isOnFire();
        }

        @Override
        protected boolean isEqual(Task other) { return other instanceof EscapeFireTask; }

        @Override
        protected String toDebugString() { return "EscapeFire"; }
    }

    private static class FindWaterTask extends Task {
        FindWaterTask() { setDebugState("FindWater"); }

        @Override
        protected void onStart(BotHandle bot) {}

        @Override
        protected Task onTick(BotHandle bot) { return null; }

        @Override
        protected void onStop(BotHandle bot, Task interruptTask) {}

        @Override
        public boolean isFinished(BotHandle bot) {
            ServerPlayer player = bot.getNativePlayer();
            return player == null || !player.isOnFire();
        }

        @Override
        protected boolean isEqual(Task other) { return other instanceof FindWaterTask; }

        @Override
        protected String toDebugString() { return "FindWater"; }
    }

    private static class PortalEscapeTask extends Task {
        PortalEscapeTask() { setDebugState("PortalEscape"); }

        @Override
        protected void onStart(BotHandle bot) {}

        @Override
        protected Task onTick(BotHandle bot) {
            // TODO: 实现传送门逃脱逻辑（随机挤动）
            return null;
        }

        @Override
        protected void onStop(BotHandle bot, Task interruptTask) {}

        @Override
        public boolean isFinished(BotHandle bot) {
            ServerPlayer player = bot.getNativePlayer();
            return player == null || player.level().getBlockState(player.blockPosition()).getBlock() != Blocks.NETHER_PORTAL;
        }

        @Override
        protected boolean isEqual(Task other) { return other instanceof PortalEscapeTask; }

        @Override
        protected String toDebugString() { return "PortalEscape"; }
    }
}