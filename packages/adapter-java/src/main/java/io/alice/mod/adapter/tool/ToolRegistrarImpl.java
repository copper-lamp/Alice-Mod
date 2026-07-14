package io.alice.mod.adapter.tool;

import io.alice.mod.adapter.api.AliceTool;
import io.alice.mod.adapter.api.ToolRegistrar;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.Collection;

/**
 * {@link ToolRegistrar} 实现。
 * <p>
 * 将附属模组的工具注册委托给内部的 {@link ToolRegistry}。
 * 实例在插件初始化完成后即失效。
 */
public class ToolRegistrarImpl implements ToolRegistrar {

    private static final Logger LOG = LoggerFactory.getLogger(ToolRegistrarImpl.class);

    private boolean active = true;

    public ToolRegistrarImpl() {}

    @Override
    public void register(AliceTool tool) {
        checkActive();
        if (tool == null) {
            throw new IllegalArgumentException("Tool must not be null");
        }
        if (tool.name() == null || tool.name().isEmpty()) {
            throw new IllegalArgumentException("Tool name must not be null or empty");
        }

        try {
            // Wrap the API AliceTool into the internal AliceTool type
            io.alice.mod.adapter.tool.AliceTool internalTool = new io.alice.mod.adapter.tool.AliceTool() {
                @Override
                public String name() { return tool.name(); }
                @Override
                public String description() { return tool.description(); }
                @Override
                public java.util.Map<String, Object> parameterSchema() { return tool.parameterSchema(); }
                @Override
                public ToolResult invoke(java.util.Map<String, Object> args) {
                    io.alice.mod.adapter.api.ToolResult apiResult = tool.invoke(args);
                    return new ToolResult(
                            apiResult.success(),
                            apiResult.message(),
                            apiResult.data(),
                            apiResult.meta(),
                            apiResult.errorCode(),
                            apiResult.errorMessage(),
                            apiResult.errorDetails()
                    );
                }
            };
            ToolRegistry.register(internalTool);
            LOG.info("Plugin registered tool: {} (from {})",
                    tool.name(), tool.getClass().getName());
        } catch (IllegalStateException e) {
            LOG.warn("Plugin tool '{}' conflicts with existing tool: {}",
                    tool.name(), e.getMessage());
        }
    }

    @Override
    public void registerAll(Collection<AliceTool> tools) {
        checkActive();
        if (tools == null) {
            throw new IllegalArgumentException("Tools collection must not be null");
        }
        for (AliceTool tool : tools) {
            if (tool == null) {
                LOG.warn("Skipping null tool in registerAll");
                continue;
            }
            try {
                register(tool);
            } catch (Exception e) {
                LOG.warn("Failed to register tool '{}': {}", tool.name(), e.getMessage());
            }
        }
    }

    @Override
    public int registeredCount() {
        return ToolRegistry.size();
    }

    /**
     * 使此注册器失效。在插件初始化完成后调用。
     */
    public void deactivate() {
        this.active = false;
    }

    private void checkActive() {
        if (!active) {
            throw new IllegalStateException(
                    "ToolRegistrar is no longer active. " +
                            "Tool registration is only allowed during plugin initialization.");
        }
    }
}
