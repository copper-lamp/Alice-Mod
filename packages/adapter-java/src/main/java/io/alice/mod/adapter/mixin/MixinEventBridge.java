package io.alice.mod.adapter.mixin;

import io.alice.mod.adapter.status.EventDispatcher;

/**
 * Mixin 事件桥接器。
 * <p>
 * 由于 Mixin 类无法直接注入非静态依赖，通过此桥接器持有 {@link EventDispatcher} 引用，
 * 供 ChatEventMixin 和 AttackEventMixin 使用。
 * <p>
 * 在 {@link io.alice.mod.adapter.world.WorldContext#initialize()} 中设置引用。
 */
public final class MixinEventBridge {

    private static volatile EventDispatcher dispatcher;

    private MixinEventBridge() {}

    /** 设置当前 EventDispatcher 引用。 */
    public static void setDispatcher(EventDispatcher d) {
        dispatcher = d;
    }

    /** 获取当前 EventDispatcher 引用（可能为 null）。 */
    public static EventDispatcher getDispatcher() {
        return dispatcher;
    }

    /** 清除引用（在 WorldContext.shutdown 时调用）。 */
    public static void clear() {
        dispatcher = null;
    }
}