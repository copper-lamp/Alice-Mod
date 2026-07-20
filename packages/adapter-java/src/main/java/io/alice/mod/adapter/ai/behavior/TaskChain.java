package io.alice.mod.adapter.ai.behavior;

import io.alice.mod.adapter.api.service.BotHandle;

import java.util.ArrayList;
import java.util.List;

/**
 * 任务链抽象基类。
 * <p>
 * 从 altoclef {@code adris.altoclef.tasksystem.TaskChain} 移植。
 * <p>
 * TaskChain 是行为树中的 Sequence 节点，负责管理一组 Task 的编排。
 * 每个 Chain 有优先级，TaskRunner 在每 tick 选择最高优先级的活跃 Chain 执行。
 */
public abstract class TaskChain {

    private final List<Task> _cachedTaskChain = new ArrayList<>();

    protected TaskChain(TaskRunner runner) {
        runner.addTaskChain(this);
    }

    // ──────────────────────────────────────────────
    //  Framework 调用方法
    // ──────────────────────────────────────────────

    /**
     * 每 tick 由 TaskRunner 调用。
     */
    public void tick(BotHandle bot) {
        _cachedTaskChain.clear();
        onTick(bot);
    }

    /**
     * 停止此 Chain 及其所有任务。
     */
    public void stop(BotHandle bot) {
        _cachedTaskChain.clear();
        onStop(bot);
    }

    // ──────────────────────────────────────────────
    //  子类实现
    // ──────────────────────────────────────────────

    protected abstract void onStop(BotHandle bot);

    /** 当被更高优先级的 Chain 中断时调用。 */
    public abstract void onInterrupt(BotHandle bot, TaskChain other);

    protected abstract void onTick(BotHandle bot);

    /** 返回当前优先级。值越大越优先执行。 */
    public abstract float getPriority(BotHandle bot);

    /** 此 Chain 当前是否活跃（有任务要执行）。 */
    public abstract boolean isActive();

    /** Chain 名称（用于调试）。 */
    public abstract String getName();

    // ──────────────────────────────────────────────
    //  任务链追踪
    // ──────────────────────────────────────────────

    /** 获取当前 tick 执行过的任务列表（用于调试/日志）。 */
    public List<Task> getTasks() {
        return _cachedTaskChain;
    }

    /** 由 Task.tick() 调用，将当前任务加入链追踪列表。 */
    void addTaskToChain(Task task) {
        _cachedTaskChain.add(task);
    }

    @Override
    public String toString() {
        return getName();
    }
}