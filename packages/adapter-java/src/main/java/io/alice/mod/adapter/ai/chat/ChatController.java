package io.alice.mod.adapter.ai.chat;

import io.alice.mod.adapter.ai.BotAccess;
import net.minecraft.network.chat.Component;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.*;
import java.util.concurrent.ConcurrentLinkedDeque;

/**
 * 对话 AI 控制器——提供聊天消息发送和接收能力。
 */
public final class ChatController {

    private static final Logger LOG = LoggerFactory.getLogger(ChatController.class);
    private static final int MAX_MESSAGES = 100;
    private static final int CONTEXT_SIZE = 20;

    // 消息队列
    private static final Deque<ChatMessage> MESSAGE_QUEUE = new ConcurrentLinkedDeque<>();

    private ChatController() {}

    /**
     * 添加消息到队列。
     */
    public static void addMessage(ChatMessage message) {
        MESSAGE_QUEUE.addLast(message);
        // 超过上限时移除最旧的
        while (MESSAGE_QUEUE.size() > MAX_MESSAGES) {
            MESSAGE_QUEUE.pollFirst();
        }
    }

    /**
     * 发送公共聊天消息。
     */
    public static ChatResult sendChat(String message, String mode) {
        ServerPlayer bot = BotAccess.getBot();
        if (bot == null) {
            return new ChatResult(false, "Bot 未找到", null);
        }

        if (message == null || message.isEmpty()) {
            return new ChatResult(false, "消息不能为空", null);
        }

        if (message.length() > 256) {
            return new ChatResult(false, "消息过长，最多256字符", null);
        }

        try {
            MinecraftServer server = BotAccess.getServer();
            if (server == null) {
                return new ChatResult(false, "服务器未就绪", null);
            }

            switch (mode != null ? mode : "chat") {
                case "chat":
                    // 普通聊天
                    bot.sendSystemMessage(Component.literal(message));
                    break;

                case "broadcast":
                    // 广播（需要权限）
                    if (!bot.hasPermissions(2)) {
                        return new ChatResult(false, "无广播权限", null);
                    }
                    server.getPlayerList().broadcastSystemMessage(
                            Component.literal("[广播] " + message), false);
                    break;

                case "emote":
                    // 表情动作
                    bot.sendSystemMessage(Component.literal("* " + bot.getName().getString() + " " + message));
                    break;

                default:
                    return new ChatResult(false, "无效的模式: " + mode, null);
            }

            return new ChatResult(true, "发送成功: " + message, null);
        } catch (Exception e) {
            LOG.error("Failed to send chat", e);
            return new ChatResult(false, "发送失败: " + e.getMessage(), null);
        }
    }

    /**
     * 发送私聊消息。
     */
    public static ChatResult sendWhisper(String target, String message) {
        ServerPlayer bot = BotAccess.getBot();
        if (bot == null) {
            return new ChatResult(false, "Bot 未找到", null);
        }

        if (target == null || target.isEmpty()) {
            return new ChatResult(false, "目标玩家不能为空", null);
        }

        if (message == null || message.isEmpty()) {
            return new ChatResult(false, "消息不能为空", null);
        }

        if (message.length() > 256) {
            return new ChatResult(false, "消息过长，最多256字符", null);
        }

        ServerPlayer targetPlayer = BotAccess.getPlayer(target);
        if (targetPlayer == null) {
            return new ChatResult(false, "玩家不在线: " + target, null);
        }

        try {
            // 私聊消息格式
            String formattedMsg = String.format("[私聊] %s -> %s: %s",
                    bot.getName().getString(), target, message);
            targetPlayer.sendSystemMessage(Component.literal(formattedMsg));
            bot.sendSystemMessage(Component.literal(formattedMsg));

            Map<String, Object> data = new HashMap<>();
            data.put("target", target);
            return new ChatResult(true, "私聊成功: 向 " + target + " 发送 \"" + message + "\"", data);
        } catch (Exception e) {
            LOG.error("Failed to send whisper", e);
            return new ChatResult(false, "发送失败: " + e.getMessage(), null);
        }
    }

    /**
     * 消息管理操作。
     */
    public static ChatResult manageMessage(String action, String messageId, String content, Map<String, Object> filter) {
        if (action == null) {
            return new ChatResult(false, "缺少 action 参数", null);
        }

        try {
            switch (action) {
                case "list":
                    return listMessages(filter);

                case "unread":
                    return getUnreadMessages();

                case "mark_read":
                    return markMessageRead(messageId);

                case "reply":
                    return replyMessage(messageId, content);

                default:
                    return new ChatResult(false, "无效的操作: " + action, null);
            }
        } catch (Exception e) {
            LOG.error("Failed to manage message", e);
            return new ChatResult(false, "操作失败: " + e.getMessage(), null);
        }
    }

    private static ChatResult listMessages(Map<String, Object> filter) {
        List<ChatMessage> messages = new ArrayList<>(MESSAGE_QUEUE);

        // 应用过滤
        if (filter != null) {
            String sender = (String) filter.get("sender");
            String type = (String) filter.get("type");
            String keyword = (String) filter.get("keyword");
            Number limitNum = (Number) filter.get("limit");

            if (sender != null) {
                messages = messages.stream().filter(m -> sender.equals(m.sender())).toList();
            }
            if (type != null) {
                messages = messages.stream().filter(m -> type.equals(m.type())).toList();
            }
            if (keyword != null) {
                messages = messages.stream().filter(m -> m.content().contains(keyword)).toList();
            }
            if (limitNum != null) {
                int limit = limitNum.intValue();
                if (messages.size() > limit) {
                    messages = messages.subList(messages.size() - limit, messages.size());
                }
            }
        }

        List<Map<String, Object>> messageList = messages.stream()
                .map(ChatController::messageToMap)
                .toList();

        Map<String, Object> data = new HashMap<>();
        data.put("messages", messageList);
        data.put("total", messages.size());

        StringBuilder sb = new StringBuilder();
        sb.append("消息列表 (").append(messages.size()).append("条):\n");
        for (var m : messages) {
            sb.append("  - [").append(m.type()).append("] ")
                    .append(m.sender()).append(": ")
                    .append(m.content())
                    .append(m.read() ? "" : " (未读)")
                    .append("\n");
        }

        return new ChatResult(true, sb.toString(), data);
    }

    private static ChatResult getUnreadMessages() {
        List<ChatMessage> unread = MESSAGE_QUEUE.stream()
                .filter(m -> !m.read())
                .toList();

        List<Map<String, Object>> messageList = unread.stream()
                .map(ChatController::messageToMap)
                .toList();

        Map<String, Object> data = new HashMap<>();
        data.put("messages", messageList);
        data.put("unreadCount", unread.size());

        StringBuilder sb = new StringBuilder();
        sb.append("未读消息 (").append(unread.size()).append("条):\n");
        for (var m : unread) {
            sb.append("  - [").append(m.type()).append("] ")
                    .append(m.sender()).append(": ")
                    .append(m.content())
                    .append("\n");
        }

        return new ChatResult(true, sb.toString(), data);
    }

    private static ChatResult markMessageRead(String messageId) {
        if (messageId == null || messageId.isEmpty()) {
            return new ChatResult(false, "缺少 message_id 参数", null);
        }

        for (ChatMessage msg : MESSAGE_QUEUE) {
            if (messageId.equals(msg.id())) {
                // 标记已读（通过替换消息）
                MESSAGE_QUEUE.remove(msg);
                MESSAGE_QUEUE.addLast(new ChatMessage(
                        msg.id(), msg.sender(), msg.content(),
                        msg.type(), msg.timestamp(), true, msg.replyTo()
                ));
                return new ChatResult(true, "已标记为已读", null);
            }
        }

        return new ChatResult(false, "消息不存在: " + messageId, null);
    }

    private static ChatResult replyMessage(String messageId, String content) {
        if (messageId == null || messageId.isEmpty()) {
            return new ChatResult(false, "缺少 message_id 参数", null);
        }

        if (content == null || content.isEmpty()) {
            return new ChatResult(false, "缺少回复内容", null);
        }

        ChatMessage original = null;
        for (ChatMessage msg : MESSAGE_QUEUE) {
            if (messageId.equals(msg.id())) {
                original = msg;
                break;
            }
        }

        if (original == null) {
            return new ChatResult(false, "消息不存在: " + messageId, null);
        }

        // 发送回复（私聊）
        ChatResult result = sendWhisper(original.sender(), content);
        if (result.success()) {
            Map<String, Object> data = new HashMap<>();
            data.put("replyTo", messageId);
            return new ChatResult(true, "回复成功", data);
        }

        return result;
    }

    private static Map<String, Object> messageToMap(ChatMessage msg) {
        Map<String, Object> map = new HashMap<>();
        map.put("id", msg.id());
        map.put("sender", msg.sender());
        map.put("content", msg.content());
        map.put("type", msg.type());
        map.put("timestamp", msg.timestamp());
        map.put("read", msg.read());
        if (msg.replyTo() != null) {
            map.put("replyTo", msg.replyTo());
        }
        return map;
    }

    // ---- 数据记录 ----

    public record ChatResult(boolean success, String message, Map<String, Object> data) {}

    public record ChatMessage(
            String id,
            String sender,
            String content,
            String type, // public, private, system
            long timestamp,
            boolean read,
            String replyTo
    ) {}
}
