package io.alice.mod.adapter.tcp;

import com.google.gson.JsonElement;

import java.util.List;
import java.util.Objects;

/**
 * JSON-RPC 2.0 消息模型。
 * <p>
 * 四种消息类型：
 * <ul>
 *   <li><b>Request</b> — 有 id，期待响应</li>
 *   <li><b>Response</b> — 对应 Request 的 id，含 result 或 error</li>
 *   <li><b>Notification</b> — 无 id，无需响应</li>
 *   <li><b>Batch</b> — 一组 Request/Notification 的 JSON 数组</li>
 * </ul>
 * <p>
 * id 类型为 {@link JsonRpcId}，支持 JSON-RPC 2.0 规范中的 String、Number 和 null。
 */
public final class JsonRpcMessage {

    private JsonRpcMessage() {}

    // ---- Request ----

    /** 客户端 → 服务端：请求消息。 */
    public record Request(
            String jsonrpc,
            JsonRpcId id,
            String method,
            JsonElement params
    ) {
        public Request {
            Objects.requireNonNull(jsonrpc, "jsonrpc");
            Objects.requireNonNull(id, "id");
            Objects.requireNonNull(method, "method");
        }

        public Request(JsonRpcId id, String method, JsonElement params) {
            this("2.0", id, method, params);
        }

        public Request(JsonRpcId id, String method) {
            this(id, method, null);
        }

        /** 使用 int id 的便捷构造。 */
        public static Request withIntId(int id, String method, JsonElement params) {
            return new Request(JsonRpcId.of(id), method, params);
        }

        public static Request withIntId(int id, String method) {
            return new Request(JsonRpcId.of(id), method);
        }
    }

    // ---- Response ----

    /** 服务端 → 客户端：成功响应。 */
    public record Response(
            String jsonrpc,
            JsonRpcId id,
            JsonElement result
    ) {
        public Response {
            Objects.requireNonNull(jsonrpc, "jsonrpc");
            Objects.requireNonNull(id, "id");
        }

        public Response(JsonRpcId id, JsonElement result) {
            this("2.0", id, result);
        }
    }

    // ---- Error ----

    /** 服务端 → 客户端：错误响应。 */
    public record Error(
            String jsonrpc,
            JsonRpcId id,
            ErrorObject error
    ) {
        public Error {
            Objects.requireNonNull(jsonrpc, "jsonrpc");
            Objects.requireNonNull(id, "id");
            Objects.requireNonNull(error, "error");
        }

        public Error(JsonRpcId id, ErrorObject error) {
            this("2.0", id, error);
        }
    }

    /** 错误对象。 */
    public record ErrorObject(
            int code,
            String message,
            JsonElement data
    ) {
        public ErrorObject(int code, String message) {
            this(code, message, null);
        }
    }

    // ---- Notification ----

    /** 任一方 → 任一方：通知消息，无 id，无需响应。 */
    public record Notification(
            String jsonrpc,
            String method,
            JsonElement params
    ) {
        public Notification {
            Objects.requireNonNull(jsonrpc, "jsonrpc");
            Objects.requireNonNull(method, "method");
        }

        public Notification(String method, JsonElement params) {
            this("2.0", method, params);
        }

        public Notification(String method) {
            this(method, null);
        }
    }

    // ---- Batch ----

    /** 批量调用：一组请求或通知。 */
    public record Batch(
            List<JsonElement> messages
    ) {
        public Batch {
            Objects.requireNonNull(messages, "messages");
        }
    }
}
