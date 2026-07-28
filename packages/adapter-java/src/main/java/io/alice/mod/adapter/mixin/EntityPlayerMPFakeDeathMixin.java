package io.alice.mod.adapter.mixin;

import carpet.patches.EntityPlayerMPFake;
import io.alice.mod.adapter.bot.BotManager;
import net.minecraft.network.chat.Component;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Redirect;

@Mixin(value = EntityPlayerMPFake.class, remap = false)
public abstract class EntityPlayerMPFakeDeathMixin {

    @Redirect(
            method = "die",
            at = @At(
                    value = "INVOKE",
                    target = "Lcarpet/patches/EntityPlayerMPFake;kill(Lnet/minecraft/network/chat/Component;)V"
            )
    )
    private void keepDeadFakePlayerConnected(EntityPlayerMPFake player, Component reason) {
        BotManager.onFakePlayerDeath(player);
    }
}
