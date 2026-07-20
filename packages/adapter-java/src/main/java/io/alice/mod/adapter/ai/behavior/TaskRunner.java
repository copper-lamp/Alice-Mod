package io.alice.mod.adapter.ai.behavior;

import io.alice.mod.adapter.api.service.BotHandle;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.ArrayList;

/**
 * 任务运行器——行为树的 Root 节点。
 * <p>
 * 从 altoclef {@code adris.altoclef.tasksystem.TaskRunner} 移植。
 * <p>
 * 职责：
 * <ul>
 *   <li>管理所有 TaskChain</li>
 *   <li>每 tick 遍历所有 Chain，选择最高优先级的活跃 Chain 执行</li>
 *   <li>当优先级变化时，通知旧 Chain 中断</li>
 * </ul>
 */
public class TaskRunner {

    private static final Logger LOG = LoggerFactory.getLogger(TaskRunner.class);

    private final ArrayList<TaskChain> _chains = new ArrayList<>();
    private boolean _active;

    private TaskChain _cachedCurrentTaskChain = null;

    public TaskRunner() {
        _active = false;
    }

    // ──────────────────────────────────────────────
    //  核心逻辑
    // ──────────────────────────────────────────────

    /**
     * 每 tick 由服务器 tick 事件驱动调用。
     * <p>
     * 遍历所有 Chain，选择最高优先级执行；如果优先级变化，通知旧 Chain 中断。
     *
     * @param bot 当前假人句柄
     */
    public void tick(BotHandle bot) {
        if (!_active) return;

        // 选择最高优先级的 Chain
        TaskChain maxChain = null;
        float maxPriority = Float.NEGATIVE_INFINITY;
        for (TaskChain chain : _chains) {
            if (!chain.isActive()) continue;
            float priority = chain.getPriority(bot);
            if (priority > maxPriority) {
                maxPriority = priority;
                maxChain = chain;
            }
        }

        // 如果当前 Chain 变化，通知旧 Chain 中断
        if (_cachedCurrentTaskChain != null && maxChain != _cachedCurrentTaskChain) {
            LOG.debug("TaskRunner: switching chain from {} (P={}) to {} (P={})",
                    _cachedCurrentTaskChain.getName(),
                    _cachedCurrentTaskChain.getPriority(bot),
                    maxChain != null ? maxChain.getName() : "null",
                    maxPriority);
            _cachedCurrentTaskChain.onInterrupt(bot, maxChain);
        }
        _cachedCurrentTaskChain = maxChain;

        // 执行最高优先级的 Chain
        if (maxChain != null) {
            maxChain.tick(bot);
        }
    }

    // ──────────────────────────────────────────────
    //  Chain 管理
    // ──────────────────────────────────────────────

    /**
     * 注册一个 TaskChain。
     */
    public void addTaskChain(TaskChain chain) {
        _chains.add(chain);
        LOG.debug("TaskRunner: added chain {}", chain.getName());
    }

    /**
     * 启用 TaskRunner。启用后每 tick 执行调度。
     */
    public void enable() {
        _active = true;
        LOG.info("TaskRunner enabled");
    }

    /**
     * 禁用 TaskRunner。停止所有 Chain。
     */
    public void disable() {
        if (_active) {
            for (TaskChain chain : _chains) {
                chain.stop(null);
            }
        }
        _active = false;
        LOG.info("TaskRunner disabled");
    }

    // ──────────────────────────────────────────────
    //  查询
    // ──────────────────────────────────────────────

    /** 获取当前正在执行的 Chain。 */
    public TaskChain getCurrentTaskChain() {
        return _cachedCurrentTaskChain;
    }

    /** 是否已启用。 */
    public boolean isActive() {
        return _active;
    }
}