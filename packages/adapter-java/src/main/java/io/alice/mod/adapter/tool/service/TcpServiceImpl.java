package io.alice.mod.adapter.tool.service;

import com.google.gson.Gson;
import com.google.gson.JsonElement;
import com.google.gson.JsonParser;
import io.alice.mod.adapter.api.service.TcpService;
import io.alice.mod.adapter.tcp.TcpClient;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.Map;

/**
 * {@link TcpService} 实现。
 * <p>
 * 桥接到 {@link TcpClient}。由于 TcpClient 目前为单例模式，
 * 此实现通过静态方法访问 TcpClient 实例。
 */
public class TcpServiceImpl implements TcpService {

    private static final Logger LOG = LoggerFactory.getLogger(TcpServiceImpl.class);

    private static final Gson GSON = new Gson();

    /** TcpClient 实例引用（由 AliceModAdapter 在初始化时设置）。 */
    private static TcpClient client;

    /**
     * 设置 TcpClient 实例。由 AliceModAdapter 在初始化时调用。
     */
    public static void setClient(TcpClient tcpClient) {
        client = tcpClient;
    }

    @Override
    public void sendNotification(String method, Map<String, Object> params) {
        if (client == null) {
            LOG.warn("TcpService: cannot send notification, TcpClient not available");
            return;
        }
        JsonElement jsonParams = params != null
                ? JsonParser.parseString(GSON.toJson(params))
                : null;
        client.sendNotification(method, jsonParams);
    }

    @Override
    public boolean isConnected() {
        return client != null && client.isConnected();
    }
}
