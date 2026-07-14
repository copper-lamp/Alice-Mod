package io.alice.mod.adapter.persistence;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.*;
import java.util.Optional;

/**
 * 数据库管理器 — 管理 SQLite 连接生命周期。
 * <p>
 * 每个世界对应一个独立的 DatabaseManager 实例，由 {@link io.alice.mod.adapter.world.WorldContext} 创建。
 * 全局数据库使用独立的 DatabaseManager 实例（可选）。
 * <p>
 * 启用 WAL 模式以提升并发读写性能。
 * 使用 Repository 模式封装表操作，对外隐藏 SQL 细节。
 */
public final class DatabaseManager implements AutoCloseable {

    private static final Logger LOG = LoggerFactory.getLogger(DatabaseManager.class);

    /** SQLite JDBC URL 前缀。 */
    private static final String JDBC_PREFIX = "jdbc:sqlite:";

    /** 当前 schema 版本。 */
    static final int SCHEMA_VERSION = 1;

    private final Path dbPath;
    private final String worldName;
    private final String instanceId;
    private Connection connection;

    // Repository 缓存
    private ConfigRepository configRepository;
    private ToolLogRepository toolLogRepository;
    private MemoryMetaRepository memoryMetaRepository;
    private EventLogRepository eventLogRepository;

    /**
     * @param dbPath     数据库文件路径
     * @param worldName  世界名
     * @param instanceId 实例 ID
     */
    public DatabaseManager(Path dbPath, String worldName, String instanceId) {
        this.dbPath = dbPath;
        this.worldName = worldName;
        this.instanceId = instanceId;
    }

    /**
     * 初始化数据库连接并执行迁移。
     * <p>
     * 幂等操作：多次调用只会初始化一次。
     */
    public synchronized void initialize() throws SQLException {
        if (connection != null && !connection.isClosed()) {
            return;
        }

        try {
            // 1. 确保目录存在
            Files.createDirectories(dbPath.getParent());
        } catch (IOException e) {
            throw new SQLException("Failed to create database directory: " + dbPath.getParent(), e);
        }

        // 2. 打开连接
        this.connection = DriverManager.getConnection(JDBC_PREFIX + dbPath.toAbsolutePath());

        // 3. 配置 PRAGMA
        try (Statement stmt = connection.createStatement()) {
            stmt.execute("PRAGMA journal_mode = WAL");
            stmt.execute("PRAGMA synchronous = NORMAL");
            stmt.execute("PRAGMA foreign_keys = ON");
            stmt.execute("PRAGMA busy_timeout = 5000");
            stmt.execute("PRAGMA cache_size = -8000");
            stmt.execute("PRAGMA temp_store = MEMORY");
            stmt.execute("PRAGMA mmap_size = 268435456");
        }

        // 4. 执行迁移
        migrate();

        // 5. 创建 Repository 实例
        this.configRepository = new ConfigRepository(this);
        this.toolLogRepository = new ToolLogRepository(this);
        this.memoryMetaRepository = new MemoryMetaRepository(this);
        this.eventLogRepository = new EventLogRepository(this);

        LOG.info("Database initialized: {} (world='{}')", dbPath, worldName);
    }

    // ── Repository 访问器 ──

    /** 获取配置存储 Repository。 */
    public ConfigRepository configs() {
        checkInitialized();
        return configRepository;
    }

    /** 获取工具执行日志 Repository。 */
    public ToolLogRepository toolLogs() {
        checkInitialized();
        return toolLogRepository;
    }

    /** 获取记忆元数据 Repository。 */
    public MemoryMetaRepository memoryMeta() {
        checkInitialized();
        return memoryMetaRepository;
    }

    /** 获取事件记录 Repository。 */
    public EventLogRepository eventLogs() {
        checkInitialized();
        return eventLogRepository;
    }

    // ── 连接管理 ──

    /**
     * 获取数据库连接（由 Repository 内部使用）。
     *
     * @return SQLite 数据库连接
     */
    Connection getConnection() {
        checkInitialized();
        return connection;
    }

    /** 获取世界名。 */
    public String getWorldName() {
        return worldName;
    }

    /** 获取实例 ID。 */
    public String getInstanceId() {
        return instanceId;
    }

    /** 获取数据库文件路径。 */
    public Path getDbPath() {
        return dbPath;
    }

    /** 检查数据库是否已初始化。 */
    public boolean isInitialized() {
        try {
            return connection != null && !connection.isClosed();
        } catch (SQLException e) {
            return false;
        }
    }

    /**
     * 关闭数据库连接。
     * <p>
     * 幂等操作：多次调用安全。
     */
    @Override
    public synchronized void close() {
        if (connection != null) {
            try {
                if (!connection.isClosed()) {
                    connection.close();
                }
            } catch (SQLException e) {
                LOG.warn("Error closing database connection: {}", dbPath, e);
            } finally {
                connection = null;
                configRepository = null;
                toolLogRepository = null;
                memoryMetaRepository = null;
                eventLogRepository = null;
            }
            LOG.info("Database closed: {} (world='{}')", dbPath, worldName);
        }
    }

    // ── 内部方法 ──

    private void checkInitialized() {
        if (!isInitialized()) {
            throw new IllegalStateException(
                    "DatabaseManager not initialized for world '" + worldName + "'. Call initialize() first.");
        }
    }

    /**
     * 执行数据库迁移。
     * <p>
     * 如果表不存在则创建所有表；如果版本低于当前版本则执行增量迁移。
     */
    private void migrate() throws SQLException {
        int currentVersion = getCurrentVersion();

        if (currentVersion == 0) {
            // 全新数据库，创建所有表
            createTables();
            try (PreparedStatement ps = connection.prepareStatement(
                    "INSERT INTO schema_version (version, description) VALUES (?, ?)")) {
                ps.setInt(1, SCHEMA_VERSION);
                ps.setString(2, "Initial schema: config, tool_logs, memory_meta, event_logs");
                ps.execute();
            }
            LOG.info("Database schema initialized to version {}", SCHEMA_VERSION);
        } else if (currentVersion < SCHEMA_VERSION) {
            // 执行增量迁移（未来扩展）
            for (int v = currentVersion + 1; v <= SCHEMA_VERSION; v++) {
                migrateTo(v);
            }
        }
    }

    /** 获取当前数据库版本（0 表示不存在）。 */
    private int getCurrentVersion() throws SQLException {
        // 检查 schema_version 表是否存在
        try (ResultSet rs = connection.getMetaData().getTables(
                null, null, "schema_version", new String[]{"TABLE"})) {
            if (!rs.next()) {
                return 0;
            }
        }

        try (Statement stmt = connection.createStatement();
             ResultSet rs = stmt.executeQuery("SELECT MAX(version) FROM schema_version")) {
            return rs.next() ? rs.getInt(1) : 0;
        }
    }

    /** 创建所有表的初始 schema。 */
    private void createTables() throws SQLException {
        try (Statement stmt = connection.createStatement()) {
            // schema_version
            stmt.execute("""
                    CREATE TABLE IF NOT EXISTS schema_version (
                        version     INTEGER PRIMARY KEY,
                        applied_at  TEXT NOT NULL DEFAULT (datetime('now')),
                        description TEXT DEFAULT ''
                    )
                    """);

            // config
            stmt.execute("""
                    CREATE TABLE IF NOT EXISTS config (
                        key         TEXT PRIMARY KEY,
                        value       TEXT NOT NULL,
                        description TEXT DEFAULT '',
                        category    TEXT DEFAULT 'general',
                        updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
                    )
                    """);
            stmt.execute("CREATE INDEX IF NOT EXISTS idx_config_category ON config(category)");

            // tool_logs
            stmt.execute("""
                    CREATE TABLE IF NOT EXISTS tool_logs (
                        id          INTEGER PRIMARY KEY AUTOINCREMENT,
                        tool_name   TEXT NOT NULL,
                        args        TEXT NOT NULL DEFAULT '{}',
                        success     INTEGER NOT NULL,
                        message     TEXT DEFAULT '',
                        duration_ms INTEGER NOT NULL,
                        world_name  TEXT NOT NULL,
                        instance_id TEXT NOT NULL,
                        bot_name    TEXT DEFAULT '',
                        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
                    )
                    """);
            stmt.execute("CREATE INDEX IF NOT EXISTS idx_tool_logs_tool_name ON tool_logs(tool_name)");
            stmt.execute("CREATE INDEX IF NOT EXISTS idx_tool_logs_created_at ON tool_logs(created_at)");
            stmt.execute("CREATE INDEX IF NOT EXISTS idx_tool_logs_world_name ON tool_logs(world_name)");

            // memory_meta
            stmt.execute("""
                    CREATE TABLE IF NOT EXISTS memory_meta (
                        id          INTEGER PRIMARY KEY AUTOINCREMENT,
                        type        TEXT NOT NULL,
                        name        TEXT DEFAULT '',
                        dimension   TEXT NOT NULL,
                        chunk_x     INTEGER NOT NULL,
                        chunk_z     INTEGER NOT NULL,
                        data        TEXT NOT NULL DEFAULT '{}',
                        importance  INTEGER DEFAULT 1,
                        tags        TEXT DEFAULT '',
                        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
                        updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
                    )
                    """);
            stmt.execute("CREATE INDEX IF NOT EXISTS idx_memory_meta_type ON memory_meta(type)");
            stmt.execute("CREATE INDEX IF NOT EXISTS idx_memory_meta_chunk ON memory_meta(dimension, chunk_x, chunk_z)");
            stmt.execute("CREATE INDEX IF NOT EXISTS idx_memory_meta_importance ON memory_meta(importance)");

            // event_logs
            stmt.execute("""
                    CREATE TABLE IF NOT EXISTS event_logs (
                        id          INTEGER PRIMARY KEY AUTOINCREMENT,
                        event_type  TEXT NOT NULL,
                        source      TEXT DEFAULT '',
                        detail      TEXT DEFAULT '',
                        data        TEXT DEFAULT '{}',
                        world_name  TEXT NOT NULL,
                        instance_id TEXT NOT NULL,
                        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
                    )
                    """);
            stmt.execute("CREATE INDEX IF NOT EXISTS idx_event_logs_type ON event_logs(event_type)");
            stmt.execute("CREATE INDEX IF NOT EXISTS idx_event_logs_created_at ON event_logs(created_at)");
            stmt.execute("CREATE INDEX IF NOT EXISTS idx_event_logs_source ON event_logs(source)");
        }
    }

    /** 执行增量迁移（未来扩展）。 */
    @SuppressWarnings("unused")
    private void migrateTo(int targetVersion) throws SQLException {
        // 未来版本在此添加迁移逻辑
        // switch (targetVersion) {
        //     case 2 -> migrateV2();
        //     case 3 -> migrateV3();
        // }
        LOG.info("No migration needed for version {} (current schema is up to date)", targetVersion);
    }

    /**
     * 执行日志清理。
     * <p>
     * 在 WorldContext.shutdown() 或 initialize() 时调用。
     */
    public synchronized void cleanOldLogs(int keepToolLogs, int keepEventLogs) {
        if (!isInitialized()) return;

        try {
            int deletedToolLogs = toolLogRepository.cleanOld(keepToolLogs);
            int deletedEventLogs = eventLogRepository.cleanOld(keepEventLogs);
            if (deletedToolLogs > 0 || deletedEventLogs > 0) {
                LOG.info("Log cleanup: removed {} tool logs, {} event logs (world='{}')",
                        deletedToolLogs, deletedEventLogs, worldName);
            }
        } catch (Exception e) {
            LOG.warn("Log cleanup failed for world '{}'", worldName, e);
        }
    }
}