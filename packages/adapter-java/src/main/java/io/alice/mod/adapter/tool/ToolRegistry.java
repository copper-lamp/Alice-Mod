package io.alice.mod.adapter.tool;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 工具注册表。
 * <p>
 * 全局单例，维护所有已注册工具的索引。
 * 注册顺序即工具列表的展示顺序，由注解扫描或手动注册决定。
 * <p>
 * 设计采用静态全局模式（与社区中同类型注册表的思路一致），
 * 因为工具集是部署级别的决策，每个工具实例携带相同副本浪费内存。
 */
public final class ToolRegistry {

    private static final Map<String, AliceTool> TOOLS = new LinkedHashMap<>();

    private ToolRegistry() {}

    /**
     * 注册一个工具。
     *
     * @param tool 工具实例
     * @throws IllegalStateException 如果同名工具已存在
     */
    public static void register(AliceTool tool) {
        AliceTool existing = TOOLS.put(tool.name(), tool);
        if (existing != null) {
            throw new IllegalStateException(
                    "Duplicate tool name: " + tool.name()
                            + " (new=" + tool.getClass().getName()
                            + ", existing=" + existing.getClass().getName() + ")");
        }
    }

    /**
     * 根据名称获取工具。
     *
     * @param name 工具名（精确匹配，不区分大小写追溯）
     * @return 工具实例，或 null
     */
    public static AliceTool get(String name) {
        if (name == null) return null;
        AliceTool exact = TOOLS.get(name);
        if (exact != null) return exact;
        // 大小写容错
        return TOOLS.get(name.toLowerCase());
    }

    /** 返回所有已注册工具（按注册顺序）。 */
    public static List<AliceTool> all() {
        return new ArrayList<>(TOOLS.values());
    }

    /** 已注册工具数量。 */
    public static int size() {
        return TOOLS.size();
    }

    /** 清空注册表（主要用于测试）。 */
    public static void clear() {
        TOOLS.clear();
    }
}
