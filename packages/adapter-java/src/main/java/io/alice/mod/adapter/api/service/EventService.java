package io.alice.mod.adapter.api.service;

import io.alice.mod.adapter.api.event.AliceEvent;

/**
 * 事件订阅服务。
 * <p>
 * 提供对 Alice Mod 内部事件的订阅能力。
 */
public interface EventService {

    /** 订阅指定类型的事件。返回的 Subscription 可用于取消订阅。 */
    Subscription subscribe(String eventType, EventHandler handler);

    /** 订阅所有事件。 */
    Subscription subscribeAll(EventHandler handler);

    /** 触发事件。 */
    void fire(AliceEvent event);

    /** 事件处理器。 */
    @FunctionalInterface
    interface EventHandler {
        /** 处理事件。 */
        void handle(AliceEvent event);
    }

    /** 订阅句柄。用于取消订阅。 */
    interface Subscription {
        /** 取消订阅。 */
        void unsubscribe();

        /** 订阅是否仍然有效。 */
        boolean isActive();
    }
}
