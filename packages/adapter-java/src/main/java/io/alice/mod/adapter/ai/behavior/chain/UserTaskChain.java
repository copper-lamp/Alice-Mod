package io.alice.mod.adapter.ai.behavior.chain;

import io.alice.mod.adapter.ai.behavior.SingleTaskChain;
import io.alice.mod.adapter.ai.behavior.Task;
import io.alice.mod.adapter.ai.behavior.TaskRunner;
import io.alice.mod.adapter.ai.event.EventBus;
import io.alice.mod.adapter.ai.event.events.TaskFinishedEvent;
import io.alice.mod.adapter.api.service.BotHandle;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * 用户任务链——执行 LLM 或玩家下达的任务。
 * <p>
 * 从 altoclef {@code adris.altoclef.chains.UserTaskChain} 移植。
 * <p>
 * 优先级：50（固定）
 * <p>
 * 职责：
 * <ul>
 *   <li>接收并执行用户定义的任务</li>
 *   <li>任务完成后触发回调并发布 {@link TaskFinishedEvent}</li>
 *   <li>支持取消当前任务</li>
 * </ul>
 */
public class UserTaskChain extends SingleTaskChain {

    private static final Logger LOG = LoggerFactory.getLogger(UserTaskChain.class);

    private Runnable currentOnFinish;
    private long taskStartTime;

    public UserTaskChain(TaskRunner runner) {
        super(runner);
    }

    // ──────────────────────────────────────────────
    //  Chain 核心
    // ──────────────────────────────────────────────

    @Override
    protected void onTick(BotHandle bot) {
        // 不在世界中时不执行
        if (!bot.inGame()) return;

        super.onTick(bot);
    }

    @Override
    public float getPriority(BotHandle bot) {
        return 50;
    }

    @Override
    public String getName() {
        return "User Tasks";
    }

    @Override
    protected void onTaskFinish(BotHandle bot) {
        double seconds = (System.currentTimeMillis() - taskStartTime) / 1000.0;
        Task oldTask = _mainTask;
        _mainTask = null;

        if (currentOnFinish != null) {
            currentOnFinish.run();
        }

        // 只有当任务真的完成了（run 没有触发新任务）才发布事件
        boolean actuallyDone = _mainTask == null;
        if (actuallyDone && oldTask != null) {
            LOG.debug("User task FINISHED: {} took {:.2f}s", oldTask, seconds);
            EventBus.publish(new TaskFinishedEvent(seconds, oldTask));
        }
    }

    // ──────────────────────────────────────────────
    //  任务控制
    // ──────────────────────────────────────────────

    /**
     * 运行一个任务。
     *
     * @param bot      假人句柄
     * @param task     要执行的任务
     * @param onFinish 完成回调
     */
    public void runTask(BotHandle bot, Task task, Runnable onFinish) {
        this.currentOnFinish = onFinish;
        this.taskStartTime = System.currentTimeMillis();

        LOG.info("User Task Set: {}", task);
        // 确保 TaskRunner 已启用
        // Runner 的启用由外部管理
        _mainTask = task;
        if (task != null) task.reset();
    }

    /**
     * 取消当前任务。
     *
     * @param bot 假人句柄
     */
    public void cancel(BotHandle bot) {
        if (_mainTask != null && _mainTask.isActive()) {
            stop(bot);
            onTaskFinish(bot);
        }
    }

    /**
     * 获取当前任务是否正在运行。
     */
    public boolean isTaskRunning() {
        return isActive();
    }
}