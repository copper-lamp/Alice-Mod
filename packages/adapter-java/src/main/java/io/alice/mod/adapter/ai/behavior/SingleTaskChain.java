package io.alice.mod.adapter.ai.behavior;

import io.alice.mod.adapter.api.service.BotHandle;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * 单任务链——管理单个 Task 的链。
 * <p>
 * 从 altoclef {@code adris.altoclef.chains.SingleTaskChain} 移植。
 * <p>
 * 行为树中的 Decorator 节点，负责：
 * <ul>
 *   <li>包装单个 Task 并管理其生命周期</li>
 *   <li>在被高优先级 Chain 中断时标记中断状态</li>
 *   <li>恢复时自动 reset 被中断的 Task</li>
 * </ul>
 */
public abstract class SingleTaskChain extends TaskChain {

    private static final Logger LOG = LoggerFactory.getLogger(SingleTaskChain.class);

    protected Task _mainTask = null;
    private boolean _interrupted = false;
    private BotHandle _bot;

    protected SingleTaskChain(TaskRunner runner) {
        super(runner);
    }

    // ──────────────────────────────────────────────
    //  Framework 调用
    // ──────────────────────────────────────────────

    @Override
    protected void onTick(BotHandle bot) {
        if (!isActive()) return;

        // 如果被中断过，恢复时自动 reset 主任务
        if (_interrupted) {
            _interrupted = false;
            if (_mainTask != null) {
                LOG.debug("Chain {}: resuming interrupted task {}", getName(), _mainTask);
                _mainTask.reset();
            }
        }

        if (_mainTask != null) {
            if (_mainTask.isFinished(bot) || _mainTask.stopped()) {
                onTaskFinish(bot);
            } else {
                _mainTask.tick(bot, this);
            }
        }
    }

    @Override
    protected void onStop(BotHandle bot) {
        if (isActive() && _mainTask != null) {
            _mainTask.stop(bot);
            _mainTask = null;
        }
    }

    // ──────────────────────────────────────────────
    //  任务管理
    // ──────────────────────────────────────────────

    /**
     * 设置/替换当前任务。
     * <p>
     * 如果已有任务运行，会自动 stop 旧任务。
     *
     * @param task 新任务（null 表示清除）
     */
    public void setTask(Task task) {
        if (_mainTask == null || !_mainTask.equals(task)) {
            if (_mainTask != null) {
                _mainTask.stop(_bot, task);
            }
            _mainTask = task;
            if (task != null) task.reset();
        }
    }

    /**
     * 设置/替换当前任务，并记录 bot 引用。
     */
    public void setTask(BotHandle bot, Task task) {
        _bot = bot;
        setTask(task);
    }

    // ──────────────────────────────────────────────
    //  中断处理
    // ──────────────────────────────────────────────

    @Override
    public void onInterrupt(BotHandle bot, TaskChain other) {
        LOG.debug("Chain Interrupted: {} by {}", getName(), other);
        _interrupted = true;
        if (_mainTask != null && _mainTask.isActive()) {
            _mainTask.interrupt(bot, null);
        }
    }

    // ──────────────────────────────────────────────
    //  查询
    // ──────────────────────────────────────────────

    @Override
    public boolean isActive() {
        return _mainTask != null;
    }

    /**
     * 当前任务是否正在运行（未被中断且未完成）。
     */
    protected boolean isCurrentlyRunning(BotHandle bot) {
        return !_interrupted && _mainTask != null
                && _mainTask.isActive() && !_mainTask.isFinished(bot);
    }

    /**
     * 获取当前主任务。
     */
    public Task getCurrentTask() {
        return _mainTask;
    }

    // ──────────────────────────────────────────────
    //  子类实现
    // ──────────────────────────────────────────────

    /** 当主任务完成时调用。子类可在此触发回调或执行后续逻辑。 */
    protected abstract void onTaskFinish(BotHandle bot);
}