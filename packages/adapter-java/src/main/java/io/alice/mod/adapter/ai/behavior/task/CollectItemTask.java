package io.alice.mod.adapter.ai.behavior.task;

import io.alice.mod.adapter.ai.behavior.ITaskRequiresGrounded;
import io.alice.mod.adapter.ai.behavior.Task;
import io.alice.mod.adapter.api.service.BotHandle;
import io.alice.mod.adapter.api.types.Vec3;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.item.ItemEntity;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.*;

/**
 * 收集掉落物任务——自动拾取地面上的指定物品。
 * <p>
 * 从 altoclef {@code adris.altoclef.tasks.movement.PickupDroppedItemTask} 移植。
 * <p>
 * 实现 {@link ITaskRequiresGrounded}，需要落地才能中断。
 */
public class CollectItemTask extends Task implements ITaskRequiresGrounded {

    private static final Logger LOG = LoggerFactory.getLogger(CollectItemTask.class);

    // ──────────────────────────────────────────────
    //  常量
    // ──────────────────────────────────────────────

    /** 收集范围（方块）。 */
    private static final double COLLECT_RANGE = 24.0;
    /** 吸引范围（方块内自动拾取）。 */
    private static final double PICKUP_RANGE = 2.5;
    /** 收集超时（tick）。 */
    private static final int COLLECT_TIMEOUT_TICKS = 600; // 30 秒

    // ──────────────────────────────────────────────
    //  状态
    // ──────────────────────────────────────────────

    private final Set<Item> targetItems;
    private int tickCount = 0;
    private ItemEntity currentTarget;

    // ──────────────────────────────────────────────
    //  构造
    // ──────────────────────────────────────────────

    public CollectItemTask(Item... items) {
        this.targetItems = new HashSet<>(Arrays.asList(items));
        setDebugState("CollectItems(" + targetItems.size() + ")");
    }

    public CollectItemTask(Collection<Item> items) {
        this.targetItems = new HashSet<>(items);
        setDebugState("CollectItems(" + items.size() + ")");
    }

    // ──────────────────────────────────────────────
    //  生命周期
    // ──────────────────────────────────────────────

    @Override
    protected void onStart(BotHandle bot) {
        tickCount = 0;
        currentTarget = null;
        LOG.debug("CollectItemTask: start collecting {} items", targetItems.size());
    }

    @Override
    protected Task onTick(BotHandle bot) {
        ServerPlayer player = bot.getNativePlayer();
        if (player == null) return null;

        tickCount++;

        // 超时检查
        if (tickCount > COLLECT_TIMEOUT_TICKS) {
            setDebugState("Collect timeout");
            return null;
        }

        // 检查背包是否已满
        // TODO : 实现背包满时自动丢弃垃圾

        // 查找最近的掉落物
        currentTarget = findClosestItemDrop(player);

        if (currentTarget == null) {
            setDebugState("No items to collect");
            // 检查背包中是否已有足够的目标物品
            boolean hasItems = checkInventory(player);
            if (hasItems) {
                return null;
            }
            return null;
        }

        // 自动拾取（在范围内自动拾取）
        double dist = Math.sqrt(player.distanceToSqr(currentTarget));
        if (dist <= PICKUP_RANGE + 1.0) {
            setDebugState("Picking up...");
            // 走到掉落物上
            return new MoveToTask(Vec3.of(
                    currentTarget.getX(),
                    currentTarget.getY(),
                    currentTarget.getZ()
            ), null, false);
        }

        // 走向掉落物
        setDebugState("Moving to item (" + String.format("%.1f", dist) + "m)");
        return new MoveToTask(Vec3.of(
                currentTarget.getX(),
                currentTarget.getY(),
                currentTarget.getZ()
        ));
    }

    @Override
    protected void onStop(BotHandle bot, Task interruptTask) {
        LOG.debug("CollectItemTask: stopped");
    }

    @Override
    public boolean isFinished(BotHandle bot) {
        // 检查是否已收集到所有目标物品
        ServerPlayer player = bot.getNativePlayer();
        if (player == null) return true;
        return checkInventory(player);
    }

    // ──────────────────────────────────────────────
    //  内部方法
    // ──────────────────────────────────────────────

    private ItemEntity findClosestItemDrop(ServerPlayer player) {
        ItemEntity closest = null;
        double minDist = COLLECT_RANGE * COLLECT_RANGE;

        for (ItemEntity item : player.serverLevel().getEntities().getAll()
                .stream()
                .filter(e -> e instanceof ItemEntity)
                .map(e -> (ItemEntity) e)
                .filter(e -> e.isAlive() && targetItems.contains(e.getItem().getItem()))
                .toList()) {

            double dist = item.distanceToSqr(player);
            if (dist < minDist) {
                minDist = dist;
                closest = item;
            }
        }
        return closest;
    }

    private boolean checkInventory(ServerPlayer player) {
        // 简化版：检查背包中是否有目标物品
        for (int i = 0; i < player.getInventory().getContainerSize(); i++) {
            ItemStack stack = player.getInventory().getItem(i);
            if (!stack.isEmpty() && targetItems.contains(stack.getItem())) {
                return true;
            }
        }
        return false;
    }

    @Override
    protected boolean isEqual(Task other) {
        if (other instanceof CollectItemTask task) {
            return task.targetItems.equals(targetItems);
        }
        return false;
    }

    @Override
    protected String toDebugString() {
        return "CollectItems(" + targetItems.size() + ")";
    }
}