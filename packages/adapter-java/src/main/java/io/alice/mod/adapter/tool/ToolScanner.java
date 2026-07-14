package io.alice.mod.adapter.tool;

import io.alice.mod.adapter.tool.annotation.ToolMethod;
import io.alice.mod.adapter.tool.annotation.ToolModule;
import io.alice.mod.adapter.tool.annotation.ToolParam;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * 工具注解扫描器。
 * <p>
 * 在模组初始化时扫描指定包路径，收集所有标注了 {@link ToolModule} 的类，
 * 将其中的 {@link ToolMethod} 方法注册为 {@link AliceTool}。
 */
public final class ToolScanner {

    private static final Logger LOG = LoggerFactory.getLogger(ToolScanner.class);

    private ToolScanner() {}

    /**
     * 扫描指定包路径中的所有类，注册工具。
     * <p>
     * 扫描逻辑：
     * <ol>
     *   <li>枚举指定包下所有标注了 {@link ToolModule} 的类</li>
     *   <li>对每个类，枚举其 public 方法中标注了 {@link ToolMethod} 的方法</li>
     *   <li>将每个方法包装为 {@link AliceTool} 实例并注册到 {@link ToolRegistry}</li>
     * </ol>
     *
     * @param packageName 要扫描的包名（如 "io.alice.mod.adapter.tool"）
     * @return 成功注册的工具数量
     */
    public static int scanAndRegister(String packageName) {
        List<Class<?>> moduleClasses = scanPackage(packageName);
        int registered = 0;

        for (Class<?> clazz : moduleClasses) {
            registered += registerModule(clazz);
        }

        LOG.info("ToolScanner: scanned package '{}', found {} module(s), registered {} tool(s)",
                packageName, moduleClasses.size(), registered);
        return registered;
    }

    /**
     * 将标注了 {@link ToolModule} 的类中的工具方法注册到注册表。
     *
     * @param clazz 工具模块类
     * @return 注册的工具数量
     */
    public static int registerModule(Class<?> clazz) {
        ToolModule moduleAnnotation = clazz.getAnnotation(ToolModule.class);
        if (moduleAnnotation == null) return 0;

        String category = moduleAnnotation.category();
        int registered = 0;

        // 获取模块的单例实例（枚举类或持有 INSTANCE 字段的类）
        Object moduleInstance = getModuleInstance(clazz);
        if (moduleInstance == null) {
            LOG.warn("Cannot get instance of {}: no INSTANCE field or enum", clazz.getName());
            return 0;
        }

        for (Method method : clazz.getMethods()) {
            ToolMethod methodAnnotation = method.getAnnotation(ToolMethod.class);
            if (methodAnnotation == null) continue;

            // 构造 AliceTool 包装器
            AliceTool tool = buildTool(moduleInstance, method, category, methodAnnotation);
            try {
                ToolRegistry.register(tool);
                registered++;
                LOG.debug("  Registered tool: {} (category={})", tool.name(), category);
            } catch (IllegalStateException e) {
                LOG.warn("  Skipped duplicate tool: {}", tool.name());
            }
        }

        return registered;
    }

    /**
     * 从标注了 {@link ToolModule} 的类构建 {@link AliceTool} 包装器。
     */
    private static AliceTool buildTool(
            Object instance, Method method, String category, ToolMethod annotation) {

        // 构建参数 Schema
        Map<String, Object> schema = buildSchema(annotation);

        return new AliceTool() {
            @Override
            public String name() {
                return annotation.name();
            }

            @Override
            public String description() {
                return annotation.description();
            }

            @Override
            public Map<String, Object> parameterSchema() {
                return schema;
            }

            @Override
            public ToolResult invoke(Map<String, Object> args) {
                try {
                    Object result = method.invoke(instance, args);
                    if (result instanceof ToolResult tr) {
                        return tr;
                    }
                    return ToolResult.ok("executed");
                } catch (Exception e) {
                    LOG.error("Tool {} execution failed", annotation.name(), e);
                    return ToolResult.fail(e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName());
                }
            }
        };
    }

    /** 从注解元数据构建 JSON Schema。 */
    private static Map<String, Object> buildSchema(ToolMethod annotation) {
        Map<String, Object> schema = new java.util.LinkedHashMap<>();
        schema.put("type", "object");

        Map<String, Object> properties = new java.util.LinkedHashMap<>();
        List<String> required = new ArrayList<>();

        for (ToolParam param : annotation.parameters()) {
            Map<String, Object> prop = new java.util.LinkedHashMap<>();
            prop.put("type", param.type());
            prop.put("description", param.description());
            properties.put(param.name(), prop);

            if (param.required()) {
                required.add(param.name());
            }
        }

        schema.put("properties", properties);
        schema.put("required", required);
        return schema;
    }

    /**
     * 获取工具模块类的单例实例。
     * <p>
     * 支持两种模式：
     * <ul>
     *   <li>枚举类：返回枚举常量</li>
     *   <li>普通类：查找名为 {@code INSTANCE} 的静态字段</li>
     * </ul>
     */
    private static Object getModuleInstance(Class<?> clazz) {
        if (clazz.isEnum()) {
            return clazz.getEnumConstants()[0];
        }
        try {
            java.lang.reflect.Field field = clazz.getDeclaredField("INSTANCE");
            if (Modifier.isStatic(field.getModifiers())) {
                field.setAccessible(true);
                return field.get(null);
            }
        } catch (NoSuchFieldException | IllegalAccessException ignored) {
            // fall through
        }
        return null;
    }

    /**
     * 扫描包路径下的所有类。
     * <p>
     * 使用 Fabric 的 ClassFinder API 或反射搜索。
     * 这里使用 Java 原生的包扫描方式（适用于 Fabric 环境）。
     */
    private static List<Class<?>> scanPackage(String packageName) {
        List<Class<?>> result = new ArrayList<>();
        try {
            ClassLoader classLoader = Thread.currentThread().getContextClassLoader();
            String path = packageName.replace('.', '/');
            var resources = classLoader.getResources(path);
            while (resources.hasMoreElements()) {
                var resource = resources.nextElement();
                if (resource.getProtocol().equals("file")) {
                    java.io.File dir = new java.io.File(resource.toURI());
                    if (dir.isDirectory()) {
                        scanDirectory(dir, packageName, result, classLoader);
                    }
                }
            }
        } catch (Exception e) {
            LOG.warn("Failed to scan package: {}", packageName, e);
        }
        return result;
    }

    /** 递归扫描目录，收集 .class 文件。 */
    private static void scanDirectory(java.io.File dir, String packageName,
                                       List<Class<?>> classes, ClassLoader classLoader) {
        java.io.File[] files = dir.listFiles();
        if (files == null) return;

        for (java.io.File file : files) {
            if (file.isDirectory()) {
                scanDirectory(file, packageName + "." + file.getName(), classes, classLoader);
            } else if (file.getName().endsWith(".class")) {
                String className = packageName + "." + file.getName().replace(".class", "");
                try {
                    Class<?> clazz = Class.forName(className);
                    if (clazz.isAnnotationPresent(ToolModule.class)) {
                        classes.add(clazz);
                    }
                } catch (ClassNotFoundException ignored) {
                    // 部分类可能无法加载（如内部类），跳过
                }
            }
        }
    }
}
