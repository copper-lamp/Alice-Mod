package io.alice.mod.adapter.ai.tracker;

import io.alice.mod.adapter.api.service.BotHandle;

/**
 * 追踪器抽象基类。
 * <p>
 * 从 altoclef {@code adris.altoclef.trackers.Tracker} 移植。
 * <p>
 * 使用 dirty 标记模式：每 tick 由 {@link TrackerManager} 标记为 dirty，
 * 查询时自动调用 {@link #updateState()} 更新缓存。
 */
public abstract class Tracker {

    protected BotHandle bot;
    private boolean dirty = true;

    /**
     * 注册到 TrackerManager。
     */
    public Tracker(TrackerManager manager) {
        manager.addTracker(this);
    }

    /** 标记为需要更新。由 TrackerManager 每 tick 调用。 */
    public void setDirty() {
        dirty = true;
    }

    /** 是否需要进行更新。 */
    protected boolean isDirty() {
        return dirty;
    }

    /** 确保数据是最新的，在子类查询方法中调用。 */
    protected void ensureUpdated() {
        if (isDirty()) {
            updateState();
            dirty = false;
        }
    }

    /** 子类实现：更新追踪数据。 */
    protected abstract void updateState();

    /** 子类实现：重置追踪数据（离开世界时调用）。 */
    protected abstract void reset();

    /** 设置 BotHandle 引用。由 TrackerManager 在注册时调用。 */
    void setBot(BotHandle bot) {
        this.bot = bot;
    }
}