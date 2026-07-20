package io.alice.mod.adapter.ai.event;

import net.minecraft.util.Tuple;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.function.Consumer;

/**
 * 全局事件总线——解耦模块间通信。
 * <p>
 * 从 altoclef {@code adris.altoclef.eventbus.EventBus} 移植。
 * <p>
 * 支持订阅/发布模式，线程安全（通过延迟添加队列实现）。
 * 订阅者可以在事件处理中安全地取消订阅。
 */
@SuppressWarnings({"rawtypes", "unchecked"})
public class EventBus {

    private static boolean _lock;

    private static final HashMap<Class, List<Subscription>> _topics = new HashMap<>();
    private static final List<Tuple<Class, Subscription>> _toAdd = new ArrayList<>();

    /**
     * 发布事件。所有订阅了该事件类型的处理器会被依次调用。
     *
     * @param event 事件对象
     * @param <T>   事件类型
     */
    public static <T> void publish(T event) {
        Class type = event.getClass();

        // 处理延迟添加的订阅
        for (Tuple<Class, Subscription> toAdd : _toAdd) {
            subscribeInternal(toAdd.getA(), toAdd.getB());
        }
        _toAdd.clear();

        if (_topics.containsKey(type)) {
            List<Subscription> subscribers = _topics.get(type);
            List<Subscription> toDelete = new ArrayList<>();

            _lock = true;
            for (Subscription subRaw : subscribers) {
                Subscription<T> sub;
                try {
                    sub = (Subscription<T>) subRaw;
                    if (sub.shouldDelete()) {
                        toDelete.add(sub);
                    } else {
                        sub.accept(event);
                    }
                } catch (ClassCastException e) {
                    System.err.println("EventBus: mismapped event type: " + event);
                    e.printStackTrace();
                }
            }
            // 删除已标记的订阅
            subscribers.removeAll(toDelete);
            _lock = false;
        }
    }

    private static <T> void subscribeInternal(Class<T> type, Subscription<T> sub) {
        _topics.computeIfAbsent(type, k -> new ArrayList<>()).add(sub);
    }

    /**
     * 订阅指定类型的事件。
     *
     * @param type          事件类型
     * @param consumeEvent 事件处理器
     * @param <T>          事件类型
     * @return 订阅对象（可用于取消订阅）
     */
    public static <T> Subscription<T> subscribe(Class<T> type, Consumer<T> consumeEvent) {
        Subscription<T> sub = new Subscription<>(consumeEvent);
        if (_lock) {
            _toAdd.add(new Tuple<>(type, sub));
        } else {
            subscribeInternal(type, sub);
        }
        return sub;
    }

    /**
     * 取消订阅。
     *
     * @param subscription 要取消的订阅对象
     * @param <T>          事件类型
     */
    public static <T> void unsubscribe(Subscription<T> subscription) {
        if (subscription != null) {
            subscription.delete();
        }
    }
}