package io.alice.mod.adapter.tcp;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import io.alice.mod.adapter.tcp.JsonRpcMessage.Batch;
import io.alice.mod.adapter.tcp.JsonRpcMessage.Error;
import io.alice.mod.adapter.tcp.JsonRpcMessage.ErrorObject;
import io.alice.mod.adapter.tcp.JsonRpcMessage.Notification;
import io.alice.mod.adapter.tcp.JsonRpcMessage.Request;
import io.alice.mod.adapter.tcp.JsonRpcMessage.Response;

import java.util.Optional;

/**
 * JSON-RPC 2.0 消息编解码器。
 * <p>
 * 使用 Gson 序列化/反序列化 JSON-RPC 消息。解析时自动识别消息类型：
 * <ul>
 *   <li>有 {@code id} + {@code method} → Request</li>
 *   <li>有 {@code id} + {@code result} → Response</li>
 *   <li>有 {@code id} + {@code error} → Error</li>
 *   <li>无 {@code id} + 有 {@code method} → Notification</li>
 *   <li>JSON 数组 → Batch</li>
 * </ul>
 * <p>
 * id 安全：使用 {@link JsonRpcId#fromJson} 解析，兼容 String、Number、null 三种类型。
 */
public final class JsonRpcCodec {

    private static final Gson GSON = new GsonBuilder()
            .disableHtmlEscaping()
            .create();

    private static final JsonParser PARSER = new JsonParser();

    private JsonRpcCodec() {}

    // ---- 序列化 ----

    /** 将 Request 序列化为 JSON 字符串。 */
    public static String toJson(Request msg) {
        JsonObject root = new JsonObject();
        root.addProperty("jsonrpc", msg.jsonrpc());
        root.add("id", msg.id().toJson());
        root.addProperty("method", msg.method());
        if (msg.params() != null) {
            root.add("params", msg.params());
        }
        return GSON.toJson(root);
    }

    /** 将 Response 序列化为 JSON 字符串。 */
    public static String toJson(Response msg) {
        JsonObject root = new JsonObject();
        root.addProperty("jsonrpc", msg.jsonrpc());
        root.add("id", msg.id().toJson());
        root.add("result", msg.result());
        return GSON.toJson(root);
    }

    /** 将 Error 序列化为 JSON 字符串。 */
    public static String toJson(Error msg) {
        JsonObject root = new JsonObject();
        root.addProperty("jsonrpc", msg.jsonrpc());
        root.add("id", msg.id().toJson());
        root.add("error", errorObjectToJson(msg.error()));
        return GSON.toJson(root);
    }

    /** 将 Notification 序列化为 JSON 字符串。 */
    public static String toJson(Notification msg) {
        JsonObject root = new JsonObject();
        root.addProperty("jsonrpc", msg.jsonrpc());
        root.addProperty("method", msg.method());
        if (msg.params() != null) {
            root.add("params", msg.params());
        }
        return GSON.toJson(root);
    }

    /** 将 Batch 序列化为 JSON 字符串。 */
    public static String toJson(Batch msg) {
        JsonArray array = new JsonArray(msg.messages().size());
        for (JsonElement elem : msg.messages()) {
            array.add(elem);
        }
        return GSON.toJson(array);
    }

    // ---- 反序列化 ----

    /**
     * 解析单条 JSON 消息并识别类型。
     *
     * @return 消息类型标识 + 解析结果
     */
    public static ParseResult parse(String json) {
        JsonElement elem = PARSER.parse(json);
        if (elem == null || !elem.isJsonObject()) {
            return ParseResult.invalid("expected JSON object");
        }
        JsonObject obj = elem.getAsJsonObject();

        // 有 id + method = Request
        if (has(obj, "id") && has(obj, "method")) {
            JsonRpcId id = JsonRpcId.fromJson(obj.get("id"));
            String method = obj.get("method").getAsString();
            JsonElement params = obj.get("params");
            return ParseResult.request(new Request(id, method, params));
        }

        // 无 id + method = Notification
        if (!has(obj, "id") && has(obj, "method")) {
            String method = obj.get("method").getAsString();
            JsonElement params = obj.get("params");
            return ParseResult.notification(new Notification(method, params));
        }

        // 有 id + result = Response
        if (has(obj, "id") && has(obj, "result")) {
            JsonRpcId id = JsonRpcId.fromJson(obj.get("id"));
            return ParseResult.response(new Response(id, obj.get("result")));
        }

        // 有 id + error = Error
        if (has(obj, "id") && has(obj, "error")) {
            JsonRpcId id = JsonRpcId.fromJson(obj.get("id"));
            return ParseResult.error(new Error(id, parseErrorObject(obj.get("error").getAsJsonObject())));
        }

        return ParseResult.invalid("unknown message structure: " + json);
    }

    /**
     * 批量解析：如果输入是 JSON 数组，返回 Batch 结果。
     */
    public static ParseResult parseBatch(String json) {
        JsonElement elem = PARSER.parse(json);
        if (elem != null && elem.isJsonArray()) {
            return ParseResult.batch(new Batch(elem.getAsJsonArray().asList()));
        }
        return parse(json);
    }

    // ---- 内部工具 ----

    private static boolean has(JsonObject obj, String key) {
        return obj.has(key) && !obj.get(key).isJsonNull();
    }

    private static JsonObject errorObjectToJson(ErrorObject err) {
        JsonObject obj = new JsonObject();
        obj.addProperty("code", err.code());
        obj.addProperty("message", err.message());
        if (err.data() != null) {
            obj.add("data", err.data());
        }
        return obj;
    }

    private static ErrorObject parseErrorObject(JsonObject obj) {
        int code = obj.get("code").getAsInt();
        String message = obj.get("message").getAsString();
        JsonElement data = obj.get("data");
        return new ErrorObject(code, message, data);
    }

    // ---- 解析结果 ----

    /** 解析结果，使用 sealed 类风格枚举。 */
    public sealed interface ParseResult
            permits ParseResult.Invalid,
                    ParseResult.RequestResult,
                    ParseResult.ResponseResult,
                    ParseResult.ErrorResult,
                    ParseResult.NotificationResult,
                    ParseResult.BatchResult {

        record Invalid(String reason) implements ParseResult {}
        record RequestResult(JsonRpcMessage.Request message) implements ParseResult {}
        record ResponseResult(JsonRpcMessage.Response message) implements ParseResult {}
        record ErrorResult(JsonRpcMessage.Error message) implements ParseResult {}
        record NotificationResult(JsonRpcMessage.Notification message) implements ParseResult {}
        record BatchResult(JsonRpcMessage.Batch message) implements ParseResult {}

        static Invalid invalid(String reason) { return new Invalid(reason); }
        static RequestResult request(Request r) { return new RequestResult(r); }
        static ResponseResult response(Response r) { return new ResponseResult(r); }
        static ErrorResult error(Error e) { return new ErrorResult(e); }
        static NotificationResult notification(Notification n) { return new NotificationResult(n); }
        static BatchResult batch(Batch b) { return new BatchResult(b); }

        /** 便利方法：提取为 Optional<Request> */
        default Optional<Request> asRequest() {
            return this instanceof RequestResult r ? Optional.of(r.message()) : Optional.empty();
        }
        default Optional<Response> asResponse() {
            return this instanceof ResponseResult r ? Optional.of(r.message()) : Optional.empty();
        }
        default Optional<Error> asError() {
            return this instanceof ErrorResult e ? Optional.of(e.message()) : Optional.empty();
        }
        default Optional<Notification> asNotification() {
            return this instanceof NotificationResult n ? Optional.of(n.message()) : Optional.empty();
        }
        default Optional<Batch> asBatch() {
            return this instanceof BatchResult b ? Optional.of(b.message()) : Optional.empty();
        }
    }
}
