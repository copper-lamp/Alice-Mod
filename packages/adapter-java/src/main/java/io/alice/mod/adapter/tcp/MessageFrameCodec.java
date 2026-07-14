package io.alice.mod.adapter.tcp;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/**
 * 消息帧编解码器。
 * <p>
 * 协议约定：每条 JSON 消息以 {@code \n}（0x0A）作为消息边界。
 * 发送时在消息末尾追加 {@code \n}；接收时按 {@code \n} 分割字节流。
 */
public final class MessageFrameCodec {

    /** 消息分隔符字节：{@code \n} */
    private static final byte DELIMITER = 0x0A;

    /** 累积的未完成数据（粘包场景） */
    private final StringBuilder buffer = new StringBuilder();

    /**
     * 将消息编码为带 {@code \n} 结尾的字节数组。
     *
     * @param message 原始 JSON 字符串
     * @return 追加 {@code \n} 后的 UTF-8 字节数组
     */
    public byte[] encode(String message) {
        return (message + "\n").getBytes(StandardCharsets.UTF_8);
    }

    /**
     * 解码接收到的数据，按 {@code \n} 分割返回完整消息帧。
     * <p>
     * 处理粘包：未完成的消息留在内部缓冲区，下次调用时继续拼接。
     *
     * @param data 新接收到的字节数据
     * @return 完整消息帧列表（按 {@code \n} 分割）
     */
    public List<String> decode(byte[] data) {
        buffer.append(new String(data, StandardCharsets.UTF_8));
        List<String> frames = new ArrayList<>();
        String content = buffer.toString();
        int start = 0;

        while (true) {
            int delimiterIndex = content.indexOf(DELIMITER, start);
            if (delimiterIndex < 0) {
                break;
            }
            String frame = content.substring(start, delimiterIndex);
            if (!frame.isEmpty()) {
                frames.add(frame);
            }
            start = delimiterIndex + 1;
        }

        // 剩余未完成的数据放回缓冲区
        buffer.delete(0, start);
        return frames;
    }

    /** 清空内部缓冲区。 */
    public void reset() {
        buffer.setLength(0);
    }
}
