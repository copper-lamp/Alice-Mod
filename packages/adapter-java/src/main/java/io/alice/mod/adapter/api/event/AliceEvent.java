package io.alice.mod.adapter.api.event;

/**
 * Alice Mod 事件基础接口。
 * <p>
 * 所有事件类型继承自此接口。
 */
public interface AliceEvent {

    /** 事件类型标识。 */
    String type();

    /** 事件发生时间戳（毫秒）。 */
    long timestamp();

    /** 事件数据。 */
    java.util.Map<String, Object> data();
}
