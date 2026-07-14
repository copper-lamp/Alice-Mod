package io.alice.mod.adapter.tool.annotation;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * 工具参数注解，标注在 {@link ToolMethod} 的参数上。
 * <p>
 * 定义每个参数的名称、类型、描述和是否必填。
 * 类型使用字符串（"number"/"string"/"boolean"/"object"），
 * 与 JSON Schema 的 {@code type} 字段保持一致。
 */
@Target({})
@Retention(RetentionPolicy.RUNTIME)
public @interface ToolParam {

    /** 参数名称（snake_case）。 */
    String name();

    /** 参数类型："number", "string", "boolean", "object" */
    String type();

    /** 参数描述。 */
    String description();

    /** 是否必填，默认 true。 */
    boolean required() default true;
}
