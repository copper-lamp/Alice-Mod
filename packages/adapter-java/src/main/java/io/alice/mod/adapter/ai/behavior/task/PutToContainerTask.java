package io.alice.mod.adapter.ai.behavior.task;

import io.alice.mod.adapter.ai.behavior.ITaskRequiresGrounded;
import io.alice.mod.adapter.ai.behavior.Task;
import io.alice.mod.adapter.api.service.BotHandle;
import io.alice.mod.adapter.api.types.Vec3;
import net.minecraft.core.BlockPos;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.Container;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.*;

/**
 * 将物品放入容器的任务。
 * <p>
 * 从 altoclef 概念移植。
 * <p>
 * 实现 {@link ITaskRequiresGrounded}，需要落地才能中断。
 */
public class PutToContainerTask extends Task implements ITaskRequiresGrounded {

    private static final Logger LOG = LoggerFactory.getLogger(PutToContainerTask.class);

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
    private final Set<Item> itemsToStore;
    private int tickCount = 0;
    private boolean containerOpened = false;

    // ──────────────────────────────────────────────
    //  构造
    // ──────────────────────────────────────────────

    public PutToContainerTask(BlockPos pos, Item... items) {
        this.containerPos = pos;
        this.itemsToStore = new HashSet<>(Arrays.asList(items));
        setDebugState("PutToContainer(" + pos.getX() + "," + pos.getY() + "," + pos.getZ() + ")");
    }

    public PutToContainerTask(BlockPos pos, Collection<Item> items) {
        this.containerPos = pos;
        this.itemsToStore = new HashSet<>(items);
        setDebugState("PutToContainer(" + pos.getX() + "," + pos.getY() + "," + pos.getZ() + ")");
    }

    // ──────────────────────────────────────────────
    //  生命周期
    // ──────────────────────────────────────────────

    @Override
    protected void onStart(BotHandle bot) {
        tickCount = 0;
        containerOpened = false;
        LOG.debug("PutToContainerTask: start at {}", containerPos);
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
            String lookCmd = String.format("player %s lookAt %.2f %.2f %.2f",
                    bot.name(),
                    containerPos.getX() + 0.5,
                    containerPos.getY() + 0.5,
                    containerPos.getZ() + 0.5);
            executeCommand(bot, lookCmd);

            String useCmd = String.format("player %s useItem", bot.name());
            executeCommand(bot, useCmd);
            containerOpened = true;
            setDebugState("Opening container...");
            return null;
        }

        // 从背包中找出目标物品并放入容器
        boolean stored = false;
        for (int i = 0; i < player.getInventory().getContainerSize(); i++) {
            ItemStack stack = player.getInventory().getItem(i);
            if (!stack.isEmpty() && itemsToStore.contains(stack.getItem())) {
                // 使用 Carpet 命令将物品放入容器
                // /player <name> inventory <slot> <action>
                String clickCmd = String.format("player %s inventory %d drop",
                        bot.name(), i);
                executeCommand(bot, clickCmd);
                stored = true;
                LOG.debug("PutToContainerTask: stored {} from slot {}", stack.getItem(), i);
                break;
            }
        }

        if (!stored) {
            // 没有更多物品需要存放
            setDebugState("Items stored");
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
        LOG.debug("PutToContainerTask: stopped");
    }

    @Override
    public boolean isFinished(BotHandle bot) {
        ServerPlayer player = bot.getNativePlayer();
        if (player == null) return true;

        // 检查背包中是否还有目标物品
        for (int i = 0; i < player.getInventory().getContainerSize(); i++) {
            ItemStack stack = player.getInventory().getItem(i);
            if (!stack.isEmpty() && itemsToStore.contains(stack.getItem())) {
                return false;
            }
        }
        return true;
    }

    private void closeContainer(ServerPlayer player) {
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
        if (other instanceof PutToContainerTask task) {
            return task.containerPos.equals(containerPos) && task.itemsToStore.equals(itemsToStore);
        }
        return false;
    }

    @Override
    protected String toDebugString() {
        return "PutToContainer(" + containerPos.getX() + "," + containerPos.getY() + "," + containerPos.getZ() + ")";
    }
}