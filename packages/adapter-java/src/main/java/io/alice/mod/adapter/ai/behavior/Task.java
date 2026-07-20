package io.alice.mod.adapter.ai.behavior;

import io.alice.mod.adapter.api.service.BotHandle;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.function.Predicate;

/**
 * 任务抽象基类。
 * <p>
 * 从 altoclef {@code adris.altoclef.tasksystem.Task} 移植。
 * <p>
 * Task 具有完整的生命周期：onStart → onTick（每 tick）→ onStop。
 * 支持子任务嵌套、中断恢复、去重判断。
 */
public abstract class Task {

    private static final Logger LOG = LoggerFactory.getLogger(Task.class);

    private String _oldDebugState = "";
    private String _debugState = "";

    private Task _sub = null;

    private boolean _first = true;
    private boolean _stopped = false;
    private boolean _active = false;

    // ──────────────────────────────────────────────
    //  Framework 调用方法
    // ──────────────────────────────────────────────

    /**
     * 每 tick 调用一次。框架自动管理子任务的生命周期。
     *
     * @param bot         假人句柄
     * @param parentChain 所属的 TaskChain
     */
    public void tick(BotHandle bot, TaskChain parentChain) {
        parentChain.addTaskToChain(this);
        if (_first) {
            LOG.debug("Task START: {}", this);
            _active = true;
            onStart(bot);
            _first = false;
            _stopped = false;
        }
        if (_stopped) return;

        Task newSub = onTick(bot);

        // Debug state print
        if (!_oldDebugState.equals(_debugState)) {
            LOG.debug(toString());
            _oldDebugState = _debugState;
        }

        // 子任务处理
        if (newSub != null) {
            if (!newSub.isEqual(_sub)) {
                if (canBeInterrupted(bot, _sub, newSub)) {
                    if (_sub != null) {
                        _sub.stop(bot, newSub);
                    }
                    _sub = newSub;
                }
            }
            // 运行子任务
            _sub.tick(bot, parentChain);
        } else {
            if (_sub != null && canBeInterrupted(bot, _sub, null)) {
                _sub.stop(bot);
                _sub = null;
            }
        }
    }

    /**
     * 复位任务。下次 tick 时重新执行 onStart。
     */
    public void reset() {
        _first = true;
        _active = false;
        _stopped = false;
    }

    /**
     * 停止任务（无中断者）。
     */
    public void stop(BotHandle bot) {
        stop(bot, null);
    }

    /**
     * 停止任务。下次运行时会重新执行 onStart。
     *
     * @param bot           假人句柄
     * @param interruptTask 中断此任务的任务（null 表示正常停止）
     */
    public void stop(BotHandle bot, Task interruptTask) {
        if (!_active) return;
        LOG.debug("Task STOP: {}, interrupted by {}", this, interruptTask);
        if (!_first) {
            onStop(bot, interruptTask);
        }
        if (_sub != null && !_sub.stopped()) {
            _sub.stop(bot, interruptTask);
        }
        _first = true;
        _active = false;
        _stopped = true;
    }

    /**
     * 中断任务（临时挂起）。仍会调用 onStop，但 isActive 保持 true。
     * 下次 tick 时自动调用 reset() 恢复。
     *
     * @param bot           假人句柄
     * @param interruptTask 中断此任务的任务
     */
    public void interrupt(BotHandle bot, Task interruptTask) {
        if (!_active) return;
        if (!_first) {
            onStop(bot, interruptTask);
        }
        if (_sub != null && !_sub.stopped()) {
            _sub.interrupt(bot, interruptTask);
        }
        _first = true;
    }

    // ──────────────────────────────────────────────
    //  Debug
    // ──────────────────────────────────────────────

    protected void setDebugState(String state) {
        if (state == null) state = "";
        _debugState = state;
    }

    @Override
    public String toString() {
        return "<" + toDebugString() + "> " + _debugState;
    }

    @Override
    public boolean equals(Object obj) {
        if (obj instanceof Task task) {
            return isEqual(task);
        }
        return false;
    }

    // ──────────────────────────────────────────────
    //  查询方法
    // ──────────────────────────────────────────────

    /** 任务是否已完成。 */
    public boolean isFinished(BotHandle bot) {
        return false;
    }

    /** 任务是否处于活跃状态（已 onStart 且未 stop）。 */
    public boolean isActive() {
        return _active;
    }

    /** 任务是否已被停止。 */
    public boolean stopped() {
        return _stopped;
    }

    /**
     * 检查当前任务或其子任务是否满足某个条件。
     */
    public boolean thisOrChildSatisfies(Predicate<Task> pred) {
        Task t = this;
        while (t != null) {
            if (pred.test(t)) return true;
            t = t._sub;
        }
        return false;
    }

    // ──────────────────────────────────────────────
    //  子类必须实现的抽象方法
    // ──────────────────────────────────────────────

    /** 任务启动时调用。初始化资源、注册 tracker、push behaviour。 */
    protected abstract void onStart(BotHandle bot);

    /**
     * 每 tick 调用。返回子 Task 或 null。
     * <ul>
     *   <li>返回子 Task → 框架自动 tick 子 Task</li>
     *   <li>返回 null → 任务自身是叶子节点</li>
     * </ul>
     */
    protected abstract Task onTick(BotHandle bot);

    /**
     * 任务停止时调用。清理资源、pop behaviour。
     *
     * @param bot           假人句柄
     * @param interruptTask 中断此任务的任务（null 表示正常停止）
     */
    protected abstract void onStop(BotHandle bot, Task interruptTask);

    /** 去重判断。防止同一 Task 被重复创建。 */
    protected abstract boolean isEqual(Task other);

    /** 调试字符串。 */
    protected abstract String toDebugString();

    // ──────────────────────────────────────────────
    //  中断控制
    // ──────────────────────────────────────────────

    /**
     * 判断子任务是否可以被中断。
     * 如果子任务实现了 ITaskCanForce 且 shouldForce 返回 true，则不可中断。
     */
    private boolean canBeInterrupted(BotHandle bot, Task subTask, Task toInterruptWith) {
        if (subTask == null) return true;
        return subTask.thisOrChildSatisfies(task -> {
            if (task instanceof ITaskCanForce canForce) {
                return !canForce.shouldForce(bot, toInterruptWith);
            }
            return true;
        });
    }
}