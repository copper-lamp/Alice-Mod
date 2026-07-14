package io.alice.mod.adapter.tool.annotation;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * 工具模块注解，标注在工具模块类上。
 * <p>
 * 被标注的类会被 {@link io.alice.mod.adapter.tool.ToolScanner} 自动发现，
 * 其中的 {@link ToolMethod} 方法会被注册为可用工具。
 */
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
public @interface ToolModule {

    /** 工具分类。 */
    String category();

    /** 模块描述。 */
    String description();
}
