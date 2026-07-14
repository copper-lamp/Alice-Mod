package io.alice.mod.adapter.api.service;

import java.util.Map;

/**
 * TCP 通信服务。
 * <p>
 * 提供与 Agent Core 的通信能力。
 */
public interface TcpService {

    /** 发送通知到 Agent Core（不需要响应）。 */
    void sendNotification(String method, Map<String, Object> params);

    /** 检查 TCP 连接是否正常。 */
    boolean isConnected();
}
