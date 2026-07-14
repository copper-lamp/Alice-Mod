package io.alice.mod.adapter.api;

import java.util.Collection;

/**
 * 工具注册器。
 * <p>
 * 附属模组在初始化阶段通过此接口向 Alice Mod 注册自定义工具。
 * 注册器由 Alice Mod 实现并注入给 {@link AliceToolPlugin}，只在插件初始化阶段可用。
 * <p>
 * 注册器封装了内部注册表，提供受限的注册视图——不允许查询、清除或取消注册。
 */
public interface ToolRegistrar {

    /**
     * 注册一个工具。
     *
     * @param tool 工具实例
     * @throws IllegalArgumentException 如果工具名为 null 或空
     * @throws IllegalStateException    如果同名工具已存在
     */
    void register(AliceTool tool);

    /**
     * 批量注册工具。
     * 每个工具独立注册，已存在的同名工具会被跳过（非原子操作）。
     *
     * @param tools 工具实例列表
     * @throws IllegalArgumentException 如果列表中有 null
     */
    void registerAll(Collection<AliceTool> tools);

    /**
     * 返回当前已注册的工具数量（包含 Alice Mod 内建工具）。
     */
    int registeredCount();
}
