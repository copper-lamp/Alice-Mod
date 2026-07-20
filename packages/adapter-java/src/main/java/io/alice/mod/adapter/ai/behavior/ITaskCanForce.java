package io.alice.mod.adapter.ai.behavior;

import io.alice.mod.adapter.api.service.BotHandle;

/**
 * 强制执行接口。
 * <p>
 * 从 altoclef {@code adris.altoclef.tasksystem.ITaskCanForce} 移植。
 * <p>
 * 实现此接口的 Task 可以声明自己不能被父 Task 中断。
 * 例如：在空中跑酷时必须完成当前跳跃，否则会摔死。
 */
public interface ITaskCanForce {

    /**
     * 判断当前任务是否应该强制继续执行，即使父 Task 想要中断它。
     *
     * @param bot                 假人句柄
     * @param interruptingCandidate 试图中断此任务的任务
     * @return true 表示强制继续，不可中断
     */
    boolean shouldForce(BotHandle bot, Task interruptingCandidate);
}