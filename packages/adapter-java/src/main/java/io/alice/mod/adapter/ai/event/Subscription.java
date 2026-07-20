package io.alice.mod.adapter.ai.event;

import java.util.function.Consumer;

/**
 * 事件订阅包装类。
 * <p>
 * 从 altoclef {@code adris.altoclef.eventbus.Subscription} 移植。
 *
 * @param <T> 事件类型
 */
public class Subscription<T> {
    private final Consumer<T> _callback;
    private boolean _shouldDelete;

    public Subscription(Consumer<T> callback) {
        _callback = callback;
    }

    public void accept(T event) {
        _callback.accept(event);
    }

    /** 标记此订阅应被删除。 */
    public void delete() {
        _shouldDelete = true;
    }

    /** 是否应被删除。 */
    public boolean shouldDelete() {
        return _shouldDelete;
    }
}