package io.alice.mod.adapter.ai.behavior.task;

import io.alice.mod.adapter.ai.behavior.ITaskOverridesGrounded;
import io.alice.mod.adapter.ai.behavior.Task;
import io.alice.mod.adapter.api.service.BotHandle;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * 装备物品任务——将背包中的指定物品装备到主手。
 * <p>
 * 实现 {@link ITaskOverridesGrounded}，空中也可以装备。
 */
public class EquipItemTask extends Task implements ITaskOverridesGrounded {

    private static final Logger LOG = LoggerFactory.getLogger(EquipItemTask.class);

    // ──────────────────────────────────────────────
    //  状态
    // ──────────────────────────────────────────────

    private final Item targetItem;
    private boolean equipped = false;

    // ──────────────────────────────────────────────
    //  构造
    // ──────────────────────────────────────────────

    public EquipItemTask(Item item) {
        this.targetItem = item;
        setDebugState("Equip(" + item.getDescriptionId() + ")");
    }

    // ──────────────────────────────────────────────
    //  生命周期
    // ──────────────────────────────────────────────

    @Override
    protected void onStart(BotHandle bot) {
        equipped = false;
        LOG.debug("EquipItemTask: start equip {}", targetItem.getDescriptionId());
    }

    @Override
    protected Task onTick(BotHandle bot) {
        ServerPlayer player = bot.getNativePlayer();
        if (player == null) return null;

        // 检查主手是否已装备
        ItemStack mainHand = player.getMainHandItem();
        if (mainHand.getItem() == targetItem) {
            setDebugState("Already equipped");
            equipped = true;
            return null;
        }

        // 在背包中查找目标物品
        int slot = findSlot(player, targetItem);
        if (slot < 0) {
            setDebugState("Item not found in inventory");
            return null;
        }

        // 装备到主手
        // 使用 Carpet 命令或直接交换槽位
        String equipCmd = String.format("player %s equip hotbar %d", bot.name(), slot);
        executeCommand(bot, equipCmd);
        equipped = true;

        setDebugState("Equipping " + targetItem.getDescriptionId());
        return null;
    }

    @Override
    protected void onStop(BotHandle bot, Task interruptTask) {
        LOG.debug("EquipItemTask: stopped");
    }

    @Override
    public boolean isFinished(BotHandle bot) {
        ServerPlayer player = bot.getNativePlayer();
        if (player == null) return true;
        return player.getMainHandItem().getItem() == targetItem;
    }

    // ──────────────────────────────────────────────
    //  内部方法
    // ──────────────────────────────────────────────

    private int findSlot(ServerPlayer player, Item item) {
        for (int i = 0; i < player.getInventory().getContainerSize(); i++) {
            ItemStack stack = player.getInventory().getItem(i);
            if (!stack.isEmpty() && stack.getItem() == item) {
                return i;
            }
        }
        return -1;
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
        if (other instanceof EquipItemTask task) {
            return task.targetItem == targetItem;
        }
        return false;
    }

    @Override
    protected String toDebugString() {
        return "Equip(" + targetItem.getDescriptionId() + ")";
    }
}