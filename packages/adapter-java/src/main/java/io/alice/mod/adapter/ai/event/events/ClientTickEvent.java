package io.alice.mod.adapter.ai.event.events;

/**
 * 客户端 tick 事件。
 * <p>
 * 每 50ms（一个游戏 tick）触发一次。
 * 用于驱动追踪器、条件监控等需要每 tick 更新的组件。
 */
public class ClientTickEvent {
    // 空事件，仅作为 tick 信号
}