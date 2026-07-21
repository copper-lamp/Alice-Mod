package io.alice.mod.adapter.mixin;

import io.alice.mod.adapter.status.EventDispatcher;
import io.alice.mod.adapter.status.MixinEventBridge;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.network.ServerGamePacketListenerImpl;
import net.minecraft.network.protocol.game.ServerboundChatPacket;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/**
 * Mixin — 监听玩家聊天事件。
 * <p>
 * 注入 {@link ServerGamePacketListenerImpl#handleChat(ServerboundChatPacket)}，
 * 捕获玩家聊天消息并通过 {@link EventDispatcher} 推送到 Agent Core。
 */
@Mixin(ServerGamePacketListenerImpl.class)
public abstract class ChatEventMixin {

    private static final Logger LOG = LoggerFactory.getLogger(ChatEventMixin.class);

    @Shadow
    public ServerPlayer player;

    @Inject(method = "handleChat", at = @At("HEAD"))
    private void onChat(ServerboundChatPacket packet, CallbackInfo ci) {
        try {
            EventDispatcher dispatcher = MixinEventBridge.getDispatcher();
            if (dispatcher == null) return;

            String playerName = player.getName().getString();
            String message = packet.message();

            dispatcher.onPlayerChat(playerName, message);
        } catch (Exception e) {
            LOG.warn("ChatEventMixin: failed to dispatch chat event", e);
        }
    }
}