package io.alice.mod.adapter.tool.service;

import io.alice.mod.adapter.api.event.AliceEvent;
import io.alice.mod.adapter.api.service.EventService;
import io.alice.mod.adapter.status.EventDispatcher;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * {@link EventService} 实现。
 * <p>
 * 基于内部的 {@link EventDispatcher} 实现事件订阅和分发。
 */
public class EventServiceImpl implements EventService {

    private static final Logger LOG = LoggerFactory.getLogger(EventServiceImpl.class);

    private final Map<String, CopyOnWriteArrayList<HandlerEntry>> handlers = new ConcurrentHashMap<>();
    private final CopyOnWriteArrayList<HandlerEntry> allHandlers = new CopyOnWriteArrayList<>();

    @Override
    public Subscription subscribe(String eventType, EventHandler handler) {
        if (eventType == null || handler == null) {
            throw new IllegalArgumentException("eventType and handler must not be null");
        }
        HandlerEntry entry = new HandlerEntry(handler);
        handlers.computeIfAbsent(eventType, k -> new CopyOnWriteArrayList<>()).add(entry);
        return entry;
    }

    @Override
    public Subscription subscribeAll(EventHandler handler) {
        if (handler == null) {
            throw new IllegalArgumentException("handler must not be null");
        }
        HandlerEntry entry = new HandlerEntry(handler);
        allHandlers.add(entry);
        return entry;
    }

    @Override
    public void fire(AliceEvent event) {
        // 调用特定类型的处理器
        CopyOnWriteArrayList<HandlerEntry> typeHandlers = handlers.get(event.type());
        if (typeHandlers != null) {
            for (HandlerEntry entry : typeHandlers) {
                try {
                    if (entry.isActive()) {
                        entry.handler().handle(event);
                    }
                } catch (Exception e) {
                    LOG.warn("Event handler failed for type '{}'", event.type(), e);
                }
            }
        }

        // 调用通配处理器
        for (HandlerEntry entry : allHandlers) {
            try {
                if (entry.isActive()) {
                    entry.handler().handle(event);
                }
            } catch (Exception e) {
                LOG.warn("Global event handler failed for type '{}'", event.type(), e);
            }
        }
    }

    /** 处理器条目，包含活跃状态。 */
    private static class HandlerEntry implements Subscription {
        private final EventHandler handler;
        private final AtomicBoolean active = new AtomicBoolean(true);

        HandlerEntry(EventHandler handler) {
            this.handler = handler;
        }

        EventHandler handler() { return handler; }

        @Override
        public void unsubscribe() {
            active.set(false);
        }

        @Override
        public boolean isActive() {
            return active.get();
        }
    }
}
