package io.alice.mod.adapter.config;

import com.mojang.brigadier.Command;
import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.arguments.StringArgumentType;
import com.mojang.brigadier.context.CommandContext;
import com.mojang.brigadier.exceptions.CommandSyntaxException;
import com.mojang.brigadier.exceptions.SimpleCommandExceptionType;
import net.fabricmc.fabric.api.command.v2.CommandRegistrationCallback;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.network.chat.Component;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.Map;

/**
 * Alice Mod Fabric 指令注册。
 *
 * <p>子命令：
 * <ul>
 *   <li>{@code /alice config get <key>} — 获取配置</li>
 *   <li>{@code /alice config set <key> <value>} — 设置配置（需要 OP）</li>
 *   <li>{@code /alice config list} — 列出所有配置</li>
 *   <li>{@code /alice status} — 查看模组运行状态</li>
 *   <li>{@code /alice reload} — 重新加载配置（需要 OP）</li>
 *   <li>{@code /alice help} — 显示帮助</li>
 * </ul>
 */
public final class AliceCommand {

    private static final Logger LOG = LoggerFactory.getLogger(AliceCommand.class);

    /** 消息前缀。 */
    private static final String PREFIX = "§7[§bAlice§7]§r ";

    /** 未激活错误。 */
    private static final SimpleCommandExceptionType NOT_ACTIVE =
            new SimpleCommandExceptionType(Component.literal("Alice Mod 未激活"));

    private AliceCommand() {}

    /**
     * 注册所有 Alice 指令。
     * <p>
     * 通过 {@link CommandRegistrationCallback} 在游戏启动时注册。
     */
    public static void register() {
        CommandRegistrationCallback.EVENT.register((dispatcher, registryAccess, environment) -> {
            registerCommands(dispatcher);
        });
        LOG.info("Alice command registration callback registered");
    }

    /**
     * 实际注册指令。
     *
     * @param dispatcher 指令调度器
     */
    private static void registerCommands(CommandDispatcher<CommandSourceStack> dispatcher) {
        dispatcher.register(Commands.literal("alice")
                .requires(src -> src.hasPermission(0))
                // /alice config
                .then(Commands.literal("config")
                        .then(Commands.literal("get")
                                .then(Commands.argument("key", StringArgumentType.word())
                                        .executes(AliceCommand::executeConfigGet)))
                        .then(Commands.literal("set")
                                .requires(src -> src.hasPermission(2))
                                .then(Commands.argument("key", StringArgumentType.word())
                                        .then(Commands.argument("value", StringArgumentType.greedyString())
                                                .executes(AliceCommand::executeConfigSet))))
                        .then(Commands.literal("list")
                                .executes(AliceCommand::executeConfigList)))
                // /alice status
                .then(Commands.literal("status")
                        .executes(AliceCommand::executeStatus))
                // /alice reload
                .then(Commands.literal("reload")
                        .requires(src -> src.hasPermission(2))
                        .executes(AliceCommand::executeReload))
                // /alice help
                .then(Commands.literal("help")
                        .executes(AliceCommand::executeHelp))
                .executes(AliceCommand::executeHelp)
        );

        LOG.info("/alice commands registered");
    }

    // ── 指令执行 ──

    private static int executeConfigGet(CommandContext<CommandSourceStack> ctx) throws CommandSyntaxException {
        String key = StringArgumentType.getString(ctx, "key");
        ConfigManager config = getConfigManager(ctx);

        config.get(key).ifPresentOrElse(
                value -> sendFeedback(ctx, "§e" + key + "§r = §a" + value),
                () -> sendFeedback(ctx, "§c配置项不存在: " + key)
        );
        return Command.SINGLE_SUCCESS;
    }

    private static int executeConfigSet(CommandContext<CommandSourceStack> ctx) throws CommandSyntaxException {
        String key = StringArgumentType.getString(ctx, "key");
        String value = StringArgumentType.getString(ctx, "value");
        ConfigManager config = getConfigManager(ctx);

        config.get(key).ifPresentOrElse(
                oldValue -> {
                    config.set(key, value);
                    sendFeedback(ctx, "§e" + key + "§r §7" + oldValue + "§r → §a" + value);
                    LOG.info("Config updated: {} = {} (was: {})", key, value, oldValue);
                },
                () -> {
                    config.set(key, value);
                    sendFeedback(ctx, "§e" + key + "§r = §a" + value + " §7(新建)");
                    LOG.info("Config created: {} = {}", key, value);
                }
        );
        return Command.SINGLE_SUCCESS;
    }

    private static int executeConfigList(CommandContext<CommandSourceStack> ctx) throws CommandSyntaxException {
        ConfigManager config = getConfigManager(ctx);
        Map<String, String> all = config.getAll();

        if (all.isEmpty()) {
            sendFeedback(ctx, "§7暂无配置项");
            return 0;
        }

        sendFeedback(ctx, "§9=== Alice 配置列表 ===");
        for (Map.Entry<String, String> entry : all.entrySet()) {
            sendFeedback(ctx, "  §e" + entry.getKey() + "§r = §a" + entry.getValue());
        }
        sendFeedback(ctx, "§9共 " + all.size() + " 项");
        return Command.SINGLE_SUCCESS;
    }

    private static int executeStatus(CommandContext<CommandSourceStack> ctx) throws CommandSyntaxException {
        var active = io.alice.mod.adapter.world.WorldContextManager.getActive();

        if (active == null) {
            sendFeedback(ctx, "§cAlice Mod 未激活（未进入世界或无 SERVER_STARTED）");
            return 0;
        }

        var identity = active.getIdentity();
        var tcp = active.getTcpClient();
        var db = active.getDatabaseManager();

        sendFeedback(ctx, "§9=== Alice Mod 状态 ===");
        sendFeedback(ctx, "  世界: §a" + identity.worldName());
        sendFeedback(ctx, "  实例: §7" + identity.instanceId());
        sendFeedback(ctx, "  TCP: " + (tcp.isConnected() ? "§a已连接" : "§c未连接"));
        sendFeedback(ctx, "  数据库: " + (db.isInitialized() ? "§a已初始化" : "§c未初始化"));
        sendFeedback(ctx, "  运行时间: §a" + (active.getUptimeMs() / 1000) + "s");
        sendFeedback(ctx, "  Bot 数量: §a" + active.getBotManager().onlineCount());
        return Command.SINGLE_SUCCESS;
    }

    private static int executeReload(CommandContext<CommandSourceStack> ctx) throws CommandSyntaxException {
        sendFeedback(ctx, "§e正在重新加载配置...");
        // ConfigManager 的 FileWatcher 会自动检测 config.json 变更
        sendFeedback(ctx, "§a配置已重新加载（文件监听模式）");
        LOG.info("Config reload triggered by command");
        return Command.SINGLE_SUCCESS;
    }

    private static int executeHelp(CommandContext<CommandSourceStack> ctx) {
        sendFeedback(ctx, "§9=== Alice Mod 指令帮助 ===");
        sendFeedback(ctx, "  §e/alice config get <key>§r  — 获取配置值");
        sendFeedback(ctx, "  §e/alice config set <key> <value>§r  — 设置配置（需 OP）");
        sendFeedback(ctx, "  §e/alice config list§r  — 列出所有配置");
        sendFeedback(ctx, "  §e/alice status§r  — 查看模组运行状态");
        sendFeedback(ctx, "  §e/alice reload§r  — 重新加载配置（需 OP）");
        sendFeedback(ctx, "  §e/alice help§r  — 显示本帮助");
        return Command.SINGLE_SUCCESS;
    }

    // ── 工具方法 ──

    /** 获取当前活跃的 ConfigManager。 */
    private static ConfigManager getConfigManager(CommandContext<CommandSourceStack> ctx)
            throws CommandSyntaxException {
        var active = io.alice.mod.adapter.world.WorldContextManager.getActive();
        if (active == null) {
            throw NOT_ACTIVE.create();
        }
        return active.getConfigManager();
    }

    /** 发送反馈消息。 */
    private static void sendFeedback(CommandContext<CommandSourceStack> ctx, String message) {
        ctx.getSource().sendSuccess(() -> Component.literal(PREFIX + message), false);
    }
}
