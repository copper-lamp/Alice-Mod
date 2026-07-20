package io.alice.mod.adapter.ai.behavior.task;

import io.alice.mod.adapter.ai.behavior.ITaskRequiresGrounded;
import io.alice.mod.adapter.ai.behavior.Task;
import io.alice.mod.adapter.api.service.BotHandle;
import io.alice.mod.adapter.api.types.Vec3;
import io.alice.mod.adapter.ai.tracker.ItemStorageTracker;
import net.minecraft.core.BlockPos;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.Container;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.*;

/**
 * 从容器中取出物品的任务。
 * <p>
 * 从 altoclef {@code adris.altoclef.tasks.container.PickupFromContainerTask} 移植。
 * <p>
 * 实现 {@link ITaskRequiresGrounded}，需要落地才能中断。
 */
public class PickupFromContainerTask extends Task implements ITaskRequiresGrounded {

    private static final Logger LOG = LoggerFactory.getLogger(PickupFromContainerTask.class);

    // ──────────────────────────────────────────────
    //  常量
    // ──────────────────────────────────────────────

    /** 容器交互距离。 */
    private static final double CONTAINER_RANGE = 4.5;
    /** 交互超时（tick）。 */
    private static final int INTERACT_TIMEOUT = 100;

    // ──────────────────────────────────────────────
    //  状态
    // ──────────────────────────────────────────────

    private final BlockPos containerPos;
    private final Set<Item> targetItems;
    private int tickCount = 0;
    private boolean containerOpened = false;

    // ──────────────────────────────────────────────
    //  构造
    // ──────────────────────────────────────────────

    public PickupFromContainerTask(BlockPos pos, Item... items) {
        this.containerPos = pos;
        this.targetItems = new HashSet<>(Arrays.asList(items));
        setDebugState("PickupFromContainer(" + pos.getX() + "," + pos.getY() + "," + pos.getZ() + ")");
    }

    public PickupFromContainerTask(BlockPos pos, Collection<Item> items) {
        this.containerPos = pos;
        this.targetItems = new HashSet<>(items);
        setDebugState("PickupFromContainer(" + pos.getX() + "," + pos.getY() + "," + pos.getZ() + ")");
    }

    // ──────────────────────────────────────────────
    //  生命周期
    // ──────────────────────────────────────────────

    @Override
    protected void onStart(BotHandle bot) {
        tickCount = 0;
        containerOpened = false;
        LOG.debug("PickupFromContainerTask: start at {}", containerPos);
    }

    @Override
    protected Task onTick(BotHandle bot) {
        ServerPlayer player = bot.getNativePlayer();
        if (player == null) return null;

        tickCount++;

        // 超时检查
        if (tickCount > INTERACT_TIMEOUT) {
            setDebugState("Container timeout");
            return null;
        }

        // 检查是否在范围内
        double dist = Math.sqrt(player.distanceToSqr(
                containerPos.getX(), containerPos.getY(), containerPos.getZ()));
        if (dist > CONTAINER_RANGE) {
            setDebugState("Moving to container");
            return new MoveToTask(Vec3.of(
                    containerPos.getX() + 0.5,
                    containerPos.getY(),
                    containerPos.getZ() + 0.5
            ));
        }

        // 打开容器
        if (!containerOpened) {
            // 面向容器
            String lookCmd = String.format("player %s lookAt %.2f %.2f %.2f",
                    bot.name(),
                    containerPos.getX() + 0.5,
                    containerPos.getY() + 0.5,
                    containerPos.getZ() + 0.5);
            executeCommand(bot, lookCmd);

            // 右键交互
            String useCmd = String.format("player %s useItem", bot.name());
            executeCommand(bot, useCmd);
            containerOpened = true;
            setDebugState("Opening container...");
            return null;
        }

        // 获取容器中的物品
        Container container = findContainer(player);
        if (container == null) {
            setDebugState("Container not found");
            return null;
        }

        // 提取目标物品
        boolean extracted = false;
        for (int i = 0; i < container.getContainerSize(); i++) {
            ItemStack stack = container.getItem(i);
            if (!stack.isEmpty() && targetItems.contains(stack.getItem())) {
                // 使用 Carpet 命令点击容器槽位
                // /player <name> inventory <slot> <action>
                String clickCmd = String.format("player %s inventory %d drop",
                        bot.name(), i);
                executeCommand(bot, clickCmd);
                extracted = true;
                LOG.debug("PickupFromContainerTask: extracted {} from slot {}", stack.getItem(), i);
                break;
            }
        }

        if (!extracted) {
            // 关闭容器并完成
            setDebugState("Items extracted or not found");
            closeContainer(player);
            return null;
        }

        return null;
    }

    @Override
    protected void onStop(BotHandle bot, Task interruptTask) {
        ServerPlayer player = bot.getNativePlayer();
        if (player != null) {
            closeContainer(player);
        }
        LOG.debug("PickupFromContainerTask: stopped");
    }

    @Override
    public boolean isFinished(BotHandle bot) {
        ServerPlayer player = bot.getNativePlayer();
        if (player == null) return true;

        // 检查背包中是否有目标物品
        for (int i = 0; i < player.getInventory().getContainerSize(); i++) {
            ItemStack stack = player.getInventory().getItem(i);
            if (!stack.isEmpty() && targetItems.contains(stack.getItem())) {
                return true;
            }
        }
        // 如果容器已被打开过且没有更多物品，也完成
        return containerOpened && containerIsEmpty(player);
    }

    // ──────────────────────────────────────────────
    //  内部方法
    // ──────────────────────────────────────────────

    private Container findContainer(ServerPlayer player) {
        var be = player.serverLevel().getBlockEntity(containerPos);
        if (be instanceof Container c) {
            return c;
        }
        return null;
    }

    private boolean containerIsEmpty(ServerPlayer player) {
        Container c = findContainer(player);
        if (c == null) return true;
        for (int i = 0; i < c.getContainerSize(); i++) {
            if (!c.getItem(i).isEmpty() && targetItems.contains(c.getItem(i).getItem())) {
                return false;
            }
        }
        return true;
    }

    private void closeContainer(ServerPlayer player) {
        // 关闭容器界面
        player.closeContainer();
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
        if (other instanceof PickupFromContainerTask task) {
            return task.containerPos.equals(containerPos) && task.targetItems.equals(targetItems);
        }
        return false;
    }

    @Override
    protected String toDebugString() {
        return "PickupFromContainer(" + containerPos.getX() + "," + containerPos.getY() + "," + containerPos.getZ() + ")";
    }
}