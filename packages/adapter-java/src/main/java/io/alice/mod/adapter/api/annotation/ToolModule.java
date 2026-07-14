package io.alice.mod.adapter.api.annotation;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * 工具模块注解，标注在工具模块类上。
 * <p>
 * 被标注的类会被 Alice Mod 的注解扫描器自动发现，
 * 其中的 {@link ToolMethod} 方法会被注册为可用工具。
 * <p>
 * 此注解适用于附属模组使用声明式方式注册工具的场景。
 */
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
public @interface ToolModule {

    /** 工具分类。 */
    String category();

    /** 模块描述。 */
    String description();
}
