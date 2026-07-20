package io.alice.mod.adapter.ai.event.events;

import io.alice.mod.adapter.ai.behavior.Task;

/**
 * 任务完成事件。
 * <p>
 * 当 Task 完成（isFinished 返回 true 或 stop 被调用）时触发。
 * 用于 Butler 跟踪任务执行状态等场景。
 */
public class TaskFinishedEvent {

    private final double durationSeconds;
    private final Task task;

    public TaskFinishedEvent(double durationSeconds, Task task) {
        this.durationSeconds = durationSeconds;
        this.task = task;
    }

    /** 任务执行耗时（秒）。 */
    public double getDurationSeconds() {
        return durationSeconds;
    }

    /** 已完成的任务。 */
    public Task getTask() {
        return task;
    }
}