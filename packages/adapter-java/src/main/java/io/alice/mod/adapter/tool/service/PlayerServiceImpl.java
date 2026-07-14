package io.alice.mod.adapter.tool.service;

import carpet.patches.EntityPlayerMPFake;
import io.alice.mod.adapter.ai.BotAccess;
import io.alice.mod.adapter.api.service.PlayerService;
import io.alice.mod.adapter.api.types.InventorySnapshot;
import io.alice.mod.adapter.api.types.ItemStackInfo;
import io.alice.mod.adapter.api.types.Vec3;
import io.alice.mod.adapter.bot.BotManager;
import io.alice.mod.adapter.world.WorldContextManager;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.item.ItemStack;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.*;

/**
 * {@link PlayerService} 实现。
 */
public class PlayerServiceImpl implements PlayerService {

    private static final Logger LOG = LoggerFactory.getLogger(PlayerServiceImpl.class);

    @Override
    public float getHealth(String botNameOrUuid) {
        ServerPlayer player = resolvePlayer(botNameOrUuid);
        return player != null ? player.getHealth() : 0;
    }

    @Override
    public int getFoodLevel(String botNameOrUuid) {
        ServerPlayer player = resolvePlayer(botNameOrUuid);
        return player != null ? player.getFoodData().getFoodLevel() : 0;
    }

    @Override
    public Vec3 getPosition(String botNameOrUuid) {
        ServerPlayer player = resolvePlayer(botNameOrUuid);
        if (player == null) return new Vec3(0, 0, 0);
        return new Vec3(player.getX(), player.getY(), player.getZ());
    }

    @Override
    public int getExperienceLevel(String botNameOrUuid) {
        ServerPlayer player = resolvePlayer(botNameOrUuid);
        return player != null ? player.experienceLevel : 0;
    }

    @Override
    public InventorySnapshot getInventory(String botNameOrUuid) {
        ServerPlayer player = resolvePlayer(botNameOrUuid);
        if (player == null) {
            return new InventorySnapshot(0, 0, List.of());
        }
        var inventory = player.getInventory();
        List<ItemStackInfo> items = new ArrayList<>();
        int usedSlots = 0;
        for (int i = 0; i < inventory.getContainerSize(); i++) {
            ItemStack stack = inventory.getItem(i);
            if (!stack.isEmpty()) {
                usedSlots++;
                items.add(new ItemStackInfo(i,
                        BuiltInRegistries.ITEM.getKey(stack.getItem()).toString(),
                        stack.getCount(),
                        Map.of()));
            }
        }
        return new InventorySnapshot(usedSlots, inventory.getContainerSize(), items);
    }

    @Override
    public List<ItemStackInfo> getEquipment(String botNameOrUuid) {
        ServerPlayer player = resolvePlayer(botNameOrUuid);
        if (player == null) return List.of();
        List<ItemStackInfo> equipment = new ArrayList<>();
        var armorSlots = player.getInventory().armor;
        for (int i = 0; i < armorSlots.size(); i++) {
            ItemStack stack = armorSlots.get(i);
            if (!stack.isEmpty()) {
                equipment.add(new ItemStackInfo(i,
                        BuiltInRegistries.ITEM.getKey(stack.getItem()).toString(),
                        stack.getCount(),
                        Map.of()));
            }
        }
        return equipment;
    }

    @Override
    public String getGameMode(String botNameOrUuid) {
        ServerPlayer player = resolvePlayer(botNameOrUuid);
        return player != null ? player.gameMode.getGameModeForPlayer().getName() : "unknown";
    }

    private ServerPlayer resolvePlayer(String nameOrUuid) {
        // 先尝试作为假人名称/UUID
        BotManager mgr = WorldContextManager.isActive()
                ? WorldContextManager.getActive().getBotManager() : null;
        if (mgr != null) {
            try {
                UUID uuid = UUID.fromString(nameOrUuid);
                EntityPlayerMPFake bot = mgr.get(uuid);
                if (bot != null) return bot;
            } catch (IllegalArgumentException ignored) {}
            EntityPlayerMPFake bot = mgr.findByName(nameOrUuid);
            if (bot != null) return bot;
        }

        // 再尝试作为真实玩家
        var server = BotAccess.getServer();
        if (server != null) {
            return server.getPlayerList().getPlayerByName(nameOrUuid);
        }
        return null;
    }
}
