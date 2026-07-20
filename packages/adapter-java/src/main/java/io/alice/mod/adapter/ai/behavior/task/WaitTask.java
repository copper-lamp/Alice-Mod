package io.alice.mod.adapter.ai.behavior.task;

import io.alice.mod.adapter.ai.behavior.ITaskOverridesGrounded;
import io.alice.mod.adapter.ai.behavior.Task;
import io.alice.mod.adapter.api.service.BotHandle;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * 等待任务——等待指定时间后完成。
 * <p>
 * 实现 {@link ITaskOverridesGrounded}，空中也可以等待。
 */
public class WaitTask extends Task implements ITaskOverridesGrounded {

    private static final Logger LOG = LoggerFactory.getLogger(WaitTask.class);

    // ──────────────────────────────────────────────
    //  状态
    // ──────────────────────────────────────────────

    private final long waitDurationMs;
    private long startTime;

    // ──────────────────────────────────────────────
    //  构造
    // ──────────────────────────────────────────────

    /**
     * @param durationMs 等待时间（毫秒）
     */
    public WaitTask(long durationMs) {
        this.waitDurationMs = durationMs;
        setDebugState("Wait(" + (durationMs / 1000) + "s)");
    }

    // ──────────────────────────────────────────────
    //  生命周期
    // ──────────────────────────────────────────────

    @Override
    protected void onStart(BotHandle bot) {
        startTime = System.currentTimeMillis();
        LOG.debug("WaitTask: start waiting {}ms", waitDurationMs);
    }

    @Override
    protected Task onTick(BotHandle bot) {
        long elapsed = System.currentTimeMillis() - startTime;
        if (elapsed >= waitDurationMs) {
            setDebugState("Wait finished");
            return null;
        }

        long remaining = (waitDurationMs - elapsed) / 1000;
        setDebugState("Waiting... (" + remaining + "s)");
        return null;
    }

    @Override
    protected void onStop(BotHandle bot, Task interruptTask) {
        LOG.debug("WaitTask: stopped after {}ms", System.currentTimeMillis() - startTime);
    }

    @Override
    public boolean isFinished(BotHandle bot) {
        return System.currentTimeMillis() - startTime >= waitDurationMs;
    }

    @Override
    protected boolean isEqual(Task other) {
        if (other instanceof WaitTask task) {
            return Math.abs(task.waitDurationMs - waitDurationMs) < 50;
        }
        return false;
    }

    @Override
    protected String toDebugString() {
        return "Wait(" + (waitDurationMs / 1000) + "s)";
    }
}