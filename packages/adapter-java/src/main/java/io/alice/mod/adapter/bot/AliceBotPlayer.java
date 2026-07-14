package io.alice.mod.adapter.bot;

import carpet.patches.EntityPlayerMPFake;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.player.Inventory;
import net.minecraft.world.item.ItemStack;

/**
 * 假人工具方法 — 围绕 Carpet {@link EntityPlayerMPFake} 的静态工具集。
 * <p>
 * 由于 Carpet 的假人构造函数为 {@code private}，无法通过继承扩展，
 * 因此将额外功能（安全装备切换、死亡标记查询等）封装为静态方法。
 * <p>
 * 所有假人实例直接使用 {@link EntityPlayerMPFake} 创建，
 * 通过 {@link #isBot(ServerPlayer)} 判断是否为假人。
 */
public final class AliceBotPlayer {

    private AliceBotPlayer() {}

    /**
     * 判断是否为假人实体。
     *
     * @param player 待检测的玩家实体
     * @return true 如果该玩家是 Carpet 假人
     */
    public static boolean isBot(ServerPlayer player) {
        return player instanceof EntityPlayerMPFake;
    }

    /**
     * 将物品栏 {@code slot} 中的物品切换到主手。
     * <p>
     * 快捷栏直接选中；主背包物品与当前选中槽交换，不丢失物品。
     * 对 {@code slot < 0} 不执行任何操作。
     *
     * @param player 假人玩家
     * @param slot   目标物品栏槽位
     */
    public static void holdInHand(ServerPlayer player, int slot) {
        if (slot < 0) return;
        Inventory inv = player.getInventory();
        if (Inventory.isHotbarSlot(slot)) {
            inv.selected = slot;
            return;
        }
        int selected = inv.selected;
        ItemStack held = inv.getItem(selected);
        inv.setItem(selected, inv.getItem(slot));
        inv.setItem(slot, held);
    }
}