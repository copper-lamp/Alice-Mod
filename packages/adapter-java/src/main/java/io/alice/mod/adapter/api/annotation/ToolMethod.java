package io.alice.mod.adapter.api.annotation;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * 工具方法注解，标注在工具模块类中的工具方法上。
 * <p>
 * 一个 {@link ToolModule} 类可以包含多个 {@link ToolMethod} 方法，
 * 每个方法对应一个可被 LLM 调用的工具。
 */
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface ToolMethod {

    /** 工具名称（snake_case，全局唯一）。 */
    String name();

    /** 工具描述（供 LLM 理解用途）。 */
    String description();

    /** 参数列表。 */
    ToolParam[] parameters() default {};

    /** 默认超时（毫秒），默认 30000。 */
    long timeout() default 30000;
}
