package io.alice.mod.adapter.ai.behavior;

/**
 * 覆盖落地要求接口。
 * <p>
 * 从 altoclef {@code adris.altoclef.tasksystem.ITaskOverridesGrounded} 移植。
 * <p>
 * 实现此接口的 Task 可以中断实现了 {@link ITaskRequiresGrounded} 的任务。
 * 主要用于水桶落地（MLG Bucket）等紧急任务。
 */
public interface ITaskOverridesGrounded {
}