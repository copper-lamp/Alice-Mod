package io.alice.mod.adapter.tool;

import io.alice.mod.adapter.tool.annotation.ToolMethod;
import io.alice.mod.adapter.tool.annotation.ToolModule;
import io.alice.mod.adapter.tool.annotation.ToolParam;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * 工具注解扫描器。
 * <p>
 * 在模组初始化时扫描指定包路径，收集所有标注了 {@link ToolModule} 的类，
 * 将其中的 {@link ToolMethod} 方法注册为 {@link AliceTool}。
 * 同时支持 {@code file:} 协议（开发环境）和 {@code jar:} 协议（生产环境）。
 */
public final class ToolScanner {

    private static final Logger LOG = LoggerFactory.getLogger(ToolScanner.class);

    private ToolScanner() {}

    /**
     * 扫描指定包路径中的所有类，注册工具。
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
     */
    public static int registerModule(Class<?> clazz) {
        ToolModule moduleAnnotation = clazz.getAnnotation(ToolModule.class);
        if (moduleAnnotation == null) return 0;

        String category = moduleAnnotation.category();
        int registered = 0;

        Object moduleInstance = getModuleInstance(clazz);
        if (moduleInstance == null) {
            LOG.warn("Cannot get instance of {}: no INSTANCE field or enum", clazz.getName());
            return 0;
        }

        for (Method method : clazz.getMethods()) {
            ToolMethod methodAnnotation = method.getAnnotation(ToolMethod.class);
            if (methodAnnotation == null) continue;

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

    private static AliceTool buildTool(
            Object instance, Method method, String category, ToolMethod annotation) {

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

    private static List<Class<?>> scanPackage(String packageName) {
        List<Class<?>> result = new ArrayList<>();
        try {
            ClassLoader classLoader = Thread.currentThread().getContextClassLoader();
            String path = packageName.replace('.', '/');
            var resources = classLoader.getResources(path);
            while (resources.hasMoreElements()) {
                var resource = resources.nextElement();
                String protocol = resource.getProtocol();
                if ("file".equals(protocol)) {
                    java.io.File dir = new java.io.File(resource.toURI());
                    if (dir.isDirectory()) {
                        scanDirectory(dir, packageName, result);
                    }
                } else if ("jar".equals(protocol)) {
                    scanJar(resource, packageName, result);
                }
            }
        } catch (Exception e) {
            LOG.warn("Failed to scan package: {}", packageName, e);
        }
        return result;
    }

    /** 扫描 JAR 包中的类，寻找标注了 {@link ToolModule} 的类。 */
    private static void scanJar(URL resource, String packageName, List<Class<?>> classes) {
        String urlPath = resource.getPath();
        int bangIndex = urlPath.indexOf('!');
        if (bangIndex < 0) return;
        // URL 格式: file:/path/to/jar!/package/path
        String jarPath = urlPath.substring(5, bangIndex);
        try (java.util.jar.JarFile jar = new java.util.jar.JarFile(
                java.net.URLDecoder.decode(jarPath, java.nio.charset.StandardCharsets.UTF_8))) {
            String packagePath = packageName.replace('.', '/');
            var entries = jar.entries();
            while (entries.hasMoreElements()) {
                var entry = entries.nextElement();
                String entryName = entry.getName();
                if (entryName.startsWith(packagePath)
                        && entryName.endsWith(".class")
                        && entryName.indexOf('$') < 0
                        && !entryName.equals(packagePath + "/module-info.class")
                        && !entryName.equals(packagePath + "/package-info.class")) {
                    String className = entryName.replace('/', '.').replace(".class", "");
                    try {
                        Class<?> clazz = Class.forName(className);
                        if (clazz.isAnnotationPresent(ToolModule.class)) {
                            classes.add(clazz);
                        }
                    } catch (ClassNotFoundException | NoClassDefFoundError ignored) {
                        // skip
                    }
                }
            }
        } catch (Exception e) {
            LOG.warn("Failed to scan jar: {}", jarPath, e);
        }
    }

    private static void scanDirectory(java.io.File dir, String packageName,
                                       List<Class<?>> classes) {
        java.io.File[] files = dir.listFiles();
        if (files == null) return;

        for (java.io.File file : files) {
            if (file.isDirectory()) {
                scanDirectory(file, packageName + "." + file.getName(), classes);
            } else if (file.getName().endsWith(".class")) {
                String className = packageName + "." + file.getName().replace(".class", "");
                try {
                    Class<?> clazz = Class.forName(className);
                    if (clazz.isAnnotationPresent(ToolModule.class)) {
                        classes.add(clazz);
                    }
                } catch (ClassNotFoundException ignored) {
                    // skip
                }
            }
        }
    }
}
