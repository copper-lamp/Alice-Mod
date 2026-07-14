package io.alice.mod.adapter.api;

import io.alice.mod.adapter.api.service.AliceServiceAccess;

/**
 * Alice Mod 工具插件入口点。
 * <p>
 * 附属模组通过实现此接口，在 Fabric 自定义 entrypoint {@code "alice-mod:plugin"}
 * 中被 Alice Mod 发现并调用。
 * <p>
 * 实现要求：
 * <ul>
 *   <li>必须有一个无参构造方法</li>
 *   <li>不应在构造方法中执行耗时操作</li>
 *   <li>所有工具注册行为应在 {@link #registerTools} 中完成</li>
 * </ul>
 *
 * <h3>使用示例</h3>
 * <pre>{@code
 * public class MyPlugin implements AliceToolPlugin {
 *     private AliceServiceAccess services;
 *
 *     &#64;Override
 *     public void registerTools(ToolRegistrar registrar, AliceServiceAccess services) {
 *         this.services = services;
 *         registrar.register(new MyTool(services));
 *     }
 * }
 * }</pre>
 *
 * <h3>fabric.mod.json 配置</h3>
 * <pre>{@code
 * "entrypoints": {
 *     "alice-mod:plugin": ["com.example.MyPlugin"]
 * }
 * }</pre>
 */
@FunctionalInterface
public interface AliceToolPlugin {

    /**
     * 在 Alice Mod 初始化时被调用，用于注册自定义工具。
     * <p>
     * 此阶段 Minecraft Server <strong>尚未启动</strong>，
     * 工具不可在此方法中访问游戏世界或假人——只能进行注册。
     * 如需使用服务，请在工具实例中保存 {@code AliceServiceAccess} 引用，
     * 在 {@link AliceTool#invoke} 方法中使用。
     *
     * @param registrar 注册器，用于注册自定义工具
     * @param services  服务访问入口，可用于后续获取 Alice Mod 内部能力
     */
    void registerTools(ToolRegistrar registrar, AliceServiceAccess services);
}
