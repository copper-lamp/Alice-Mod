package io.alice.mod.adapter.ai.behavior;

import io.alice.mod.adapter.api.service.BotHandle;

/**
 * 需要地面/落地状态的任务接口。
 * <p>
 * 从 altoclef {@code adris.altoclef.tasksystem.ITaskRequiresGrounded} 移植。
 * <p>
 * 实现此接口的 Task 在落地之前不可中断，否则可能摔死。
 * 例如：跑酷跳跃、搭路等。
 * <p>
 * 如果中断者实现了 {@link ITaskOverridesGrounded}，则允许中断。
 */
public interface ITaskRequiresGrounded extends ITaskCanForce {

    @Override
    default boolean shouldForce(BotHandle bot, Task interruptingCandidate) {
        // 如果中断任务覆盖了落地要求，则允许中断
        if (interruptingCandidate instanceof ITaskOverridesGrounded) {
            return false;
        }
        // 使用原生玩家对象判断是否在空中
        Object nativePlayer = bot.getNativePlayer();
        if (nativePlayer instanceof net.minecraft.server.level.ServerPlayer player) {
            return !(player.onGround()
                    || player.isSwimming()
                    || player.isInWater()
                    || player.onClimbable());
        }
        return false;
    }
}