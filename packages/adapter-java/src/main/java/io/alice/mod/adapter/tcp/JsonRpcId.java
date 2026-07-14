package io.alice.mod.adapter.tcp;

import com.google.gson.JsonElement;
import com.google.gson.JsonPrimitive;

import java.util.Objects;

/**
 * JSON-RPC 2.0 消息 ID。
 * <p>
 * 按 JSON-RPC 2.0 规范，id 可以是 {@code String}、{@code Number} 或 {@code null}。
 * 本类型统一封装三种情况，提供安全的序列化和匹配支持。
 */
public final class JsonRpcId {

    private static final JsonRpcId NULL_ID = new JsonRpcId(null, null, Kind.NULL);

    private final Integer intValue;
    private final String stringValue;
    private final Kind kind;

    private JsonRpcId(Integer intValue, String stringValue, Kind kind) {
        this.intValue = intValue;
        this.stringValue = stringValue;
        this.kind = kind;
    }

    // ---- 工厂方法 ----

    /** 创建数字类型 id。 */
    public static JsonRpcId of(int id) {
        return new JsonRpcId(id, null, Kind.NUMBER);
    }

    /** 创建字符串类型 id。 */
    public static JsonRpcId of(String id) {
        Objects.requireNonNull(id, "string id must not be null");
        return new JsonRpcId(null, id, Kind.STRING);
    }

    /** 创建 null id（仅限通知，不会出现在 Request/Response/Error 中）。 */
    public static JsonRpcId nullId() {
        return NULL_ID;
    }

    /**
     * 从 Gson {@link JsonElement} 解析 id。
     * <p>
     * 安全处理 {@link com.google.gson.JsonPrimitive#isNumber()} 和
     * {@code isString()} 两种类型；JSON null 返回 nullId。
     */
    public static JsonRpcId fromJson(JsonElement element) {
        if (element == null || element.isJsonNull()) {
            return NULL_ID;
        }
        JsonPrimitive prim = element.getAsJsonPrimitive();
        if (prim.isNumber()) {
            return of(prim.getAsInt());
        }
        return of(prim.getAsString());
    }

    // ---- 类型判断 ----

    public boolean isNumber() { return kind == Kind.NUMBER; }
    public boolean isString() { return kind == Kind.STRING; }
    public boolean isNull()   { return kind == Kind.NULL; }

    /** 当 id 为数字时返回 int 值；否则抛出 IllegalStateException。 */
    public int asInt() {
        if (kind != Kind.NUMBER) {
            throw new IllegalStateException("id is not a number: " + kind);
        }
        return intValue;
    }

    /** 当 id 为字符串时返回字符串值；否则抛出 IllegalStateException。 */
    public String asString() {
        if (kind != Kind.STRING) {
            throw new IllegalStateException("id is not a string: " + kind);
        }
        return stringValue;
    }

    /**
     * 转为 Gson {@link JsonElement}，用于序列化。
     * 数字 → {@code JsonPrimitive(13)}，字符串 → {@code JsonPrimitive("abc")}，null → {@code JsonNull.INSTANCE}。
     */
    public JsonElement toJson() {
        return switch (kind) {
            case NUMBER  -> new JsonPrimitive(intValue);
            case STRING  -> new JsonPrimitive(stringValue);
            case NULL    -> com.google.gson.JsonNull.INSTANCE;
        };
    }

    /** 获取原始的 JSON 字符串表示（用于调试和日志）。 */
    public String toRawString() {
        return switch (kind) {
            case NUMBER  -> String.valueOf(intValue);
            case STRING  -> "\"" + stringValue + "\"";
            case NULL    -> "null";
        };
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof JsonRpcId other)) return false;
        return kind == other.kind
                && Objects.equals(intValue, other.intValue)
                && Objects.equals(stringValue, other.stringValue);
    }

    @Override
    public int hashCode() {
        return switch (kind) {
            case NUMBER  -> intValue.hashCode();
            case STRING  -> stringValue.hashCode();
            case NULL    -> 0;
        };
    }

    @Override
    public String toString() {
        return "JsonRpcId{" + toRawString() + "}";
    }

    private enum Kind { NUMBER, STRING, NULL }
}
