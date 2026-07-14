package io.alice.mod.adapter.tcp;

/**
 * TCP 连接状态枚举。
 * <p>
 * 状态转换：
 * <pre>
 *   DISCONNECTED → CONNECTING → CONNECTED
 *       ↑              ↓
 *       └── RECONNECTING ←──┘
 * </pre>
 */
public enum ConnectionState {
    /** 已断开，不活跃 */
    DISCONNECTED,
    /** 正在建立初始连接 */
    CONNECTING,
    /** 已连接且握手完成 */
    CONNECTED,
    /** 断线后正在重连 */
    RECONNECTING
}
