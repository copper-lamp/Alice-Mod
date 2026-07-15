package io.alice.mod.adapter.config;

import java.nio.file.Path;

/**
 * Alice 数据目录路径工具类。
 * <p>
 * 统一管理所有 Alice 模组数据文件在游戏根目录下的路径。
 * V12 将数据目录从 {@code config/mcagent/} 迁移到 {@code Alice/}。
 * <p>
 * 目录结构：
 * <pre>
 * &lt;gameDir&gt;/
 * ├── Alice/
 * │   ├── mcagent_instance.json   -- 入口文件（AC 发现用）
 * │   ├── world_identity.json     -- 世界身份（服务器级）
 * │   ├── config.json              -- 配置文件（热加载）
 * │   ├── mcagent.db              -- 全局数据库（保留备用）
 * │   ├── logs/                    -- 日志目录
 * │   └── worlds/                  -- 按世界隔离的数据库
 * │       └── &lt;world_name&gt;/
 * │           ├── mcagent.db      -- 该世界的 SQLite 数据库
 * │           └── world_identity.json -- 世界身份（存档级）
 * </pre>
 */
public final class AlicePaths {

    /** Alice 数据根目录名（相对于游戏根目录）。 */
    public static final String ALICE_DIR = "Alice";

    /** 世界数据子目录。 */
    public static final String WORLDS_DIR = "worlds";

    /** 入口文件名。 */
    public static final String INSTANCE_FILE = "mcagent_instance.json";

    /** 身份文件名。 */
    public static final String IDENTITY_FILE = "world_identity.json";

    /** 配置文件名。 */
    public static final String CONFIG_FILE = "config.json";

    /** 数据库文件名。 */
    public static final String DB_FILE = "mcagent.db";

    /** 智能体配置目录名。 */
    public static final String AGENTS_DIR = "agents";

    /** 日志目录名。 */
    public static final String LOGS_DIR = "logs";

    /** 旧路径（用于迁移检测）。 */
    private static final String OLD_CONFIG_DIR = "config/mcagent";

    private AlicePaths() {}

    // ── 顶层目录 ──

    /** 获取 Alice 数据根目录。 */
    public static Path aliceDir(Path gameDir) {
        return gameDir.resolve(ALICE_DIR);
    }

    /** 获取旧数据目录。 */
    public static Path oldConfigDir(Path gameDir) {
        return gameDir.resolve(OLD_CONFIG_DIR);
    }

    /** 获取智能体配置目录。 */
    public static Path agentsDir(Path gameDir) {
        return aliceDir(gameDir).resolve(AGENTS_DIR);
    }

    /** 获取日志目录。 */
    public static Path logsDir(Path gameDir) {
        return aliceDir(gameDir).resolve(LOGS_DIR);
    }

    // ── 文件路径（服务器级） ──

    /** 获取入口 JSON 文件路径。 */
    public static Path instanceFile(Path gameDir) {
        return aliceDir(gameDir).resolve(INSTANCE_FILE);
    }

    /** 获取世界身份文件路径（服务器级）。 */
    public static Path identityFile(Path gameDir) {
        return aliceDir(gameDir).resolve(IDENTITY_FILE);
    }

    /** 获取配置文件路径。 */
    public static Path configFile(Path gameDir) {
        return aliceDir(gameDir).resolve(CONFIG_FILE);
    }

    // ── 文件路径（世界级，在 worlds/ 子目录下） ──

    /** 获取指定世界的身份文件路径。 */
    public static Path identityFileForWorld(Path gameDir, String worldName) {
        return aliceDir(gameDir).resolve(WORLDS_DIR)
                .resolve(sanitize(worldName))
                .resolve(IDENTITY_FILE);
    }

    /** 获取指定世界的数据库文件路径。 */
    public static Path worldDbPath(Path gameDir, String worldName) {
        return aliceDir(gameDir).resolve(WORLDS_DIR)
                .resolve(sanitize(worldName))
                .resolve(DB_FILE);
    }

    // ── 存档级路径（单人模式，在 saves/ 子目录下） ──

    /** 获取单人存档的身份文件路径。 */
    public static Path worldIdentityFileForSave(Path gameDir, String saveName) {
        return gameDir.resolve("saves")
                .resolve(sanitize(saveName))
                .resolve(ALICE_DIR)
                .resolve(IDENTITY_FILE);
    }

    // ── 工具方法 ──

    /** 清理路径名中的非法字符。 */
    public static String sanitize(String name) {
        return name.replaceAll("[^a-zA-Z0-9_\\-]", "_");
    }
}
