package io.alice.mod.adapter.tool.chat;

import io.alice.mod.adapter.ai.chat.ChatController;
import io.alice.mod.adapter.tool.ToolResult;
import io.alice.mod.adapter.tool.annotation.ToolMethod;
import io.alice.mod.adapter.tool.annotation.ToolModule;
import io.alice.mod.adapter.tool.annotation.ToolParam;

import java.util.Map;

/**
 * 对话工具模块——提供聊天消息发送和接收能力。
 */
@ToolModule(category = "chat", description = "对话类工具")
public enum ChatTools {
    INSTANCE;

    @ToolMethod(
            name = "chat",
            description = "发送聊天消息，支持普通聊天、广播、表情动作三种模式",
            parameters = {
                    @ToolParam(name = "message", type = "string", description = "消息内容"),
                    @ToolParam(name = "mode", type = "string",
                            description = "聊天模式: chat/broadcast/emote", required = false)
            }
    )
    public ToolResult chat(Map<String, Object> params) {
        long start = System.currentTimeMillis();
        try {
            String message = (String) params.get("message");
            String mode = (String) params.getOrDefault("mode", "chat");

            var result = ChatController.sendChat(message, mode);
            if (result.success()) {
                return ToolResult.ok(result.message(), result.data(), start);
            } else {
                String errorCode = switch (result.message()) {
                    case "消息过长，最多256字符" -> "MESSAGE_TOO_LONG";
                    case "无广播权限" -> "NO_PERMISSION";
                    default -> "INTERNAL_ERROR";
                };
                return ToolResult.fail(errorCode, result.message(), start);
            }
        } catch (Exception e) {
            return ToolResult.fail("INTERNAL_ERROR", e.getMessage(), start);
        }
    }

    @ToolMethod(
            name = "whisper",
            description = "私聊",
            parameters = {
                    @ToolParam(name = "target", type = "string", description = "玩家名"),
                    @ToolParam(name = "message", type = "string", description = "消息内容")
            }
    )
    public ToolResult whisper(Map<String, Object> params) {
        long start = System.currentTimeMillis();
        try {
            String target = (String) params.get("target");
            String message = (String) params.get("message");

            var result = ChatController.sendWhisper(target, message);
            if (result.success()) {
                return ToolResult.ok(result.message(), result.data(), start);
            } else {
                String errorCode;
                if (result.message().startsWith("玩家不在线:")) {
                    errorCode = "PLAYER_NOT_FOUND";
                } else if (result.message().equals("消息过长，最多256字符")) {
                    errorCode = "MESSAGE_TOO_LONG";
                } else {
                    errorCode = "INTERNAL_ERROR";
                }
                return ToolResult.fail(errorCode, result.message(), start);
            }
        } catch (Exception e) {
            return ToolResult.fail("INTERNAL_ERROR", e.getMessage(), start);
        }
    }

    @ToolMethod(
            name = "message",
            description = "消息管理，支持消息列表查询、未读消息、标记已读、回复消息",
            parameters = {
                    @ToolParam(name = "action", type = "string",
                            description = "操作类型: list/unread/mark_read/reply"),
                    @ToolParam(name = "message_id", type = "string",
                            description = "消息ID（标记已读或回复时使用）", required = false),
                    @ToolParam(name = "content", type = "string",
                            description = "回复内容（回复时使用）", required = false),
                    @ToolParam(name = "filter", type = "object",
                            description = "过滤条件: {sender, type, keyword, limit}", required = false)
            }
    )
    public ToolResult message(Map<String, Object> params) {
        long start = System.currentTimeMillis();
        try {
            String action = (String) params.get("action");
            String messageId = (String) params.get("message_id");
            String content = (String) params.get("content");

            @SuppressWarnings("unchecked")
            Map<String, Object> filter = (Map<String, Object>) params.get("filter");

            var result = ChatController.manageMessage(action, messageId, content, filter);
            if (result.success()) {
                return ToolResult.ok(result.message(), result.data(), start);
            } else {
                String errorCode = switch (result.message()) {
                    case String s when s.startsWith("消息不存在") -> "MESSAGE_NOT_FOUND";
                    default -> "INTERNAL_ERROR";
                };
                return ToolResult.fail(errorCode, result.message(), start);
            }
        } catch (Exception e) {
            return ToolResult.fail("INTERNAL_ERROR", e.getMessage(), start);
        }
    }
}
