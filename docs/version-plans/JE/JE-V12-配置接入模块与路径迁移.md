# Alice Mod JE V12 — 配置接入模块与路径迁移

> 版本：v1.0
> 日期：2026-07-15
> 版本号：V12
> 模块：Alice Mod JE — Fabric 模组
> 关联文档：[JE-04-架构与开发路线.md](JE-04-架构与开发路线.md)、[JE-02-实施计划.md](JE-02-实施计划.md)、[JE-进度跟踪.md](JE-进度跟踪.md)、[01-通信协议规范.md](../../protocols/01-通信协议规范.md)

---

## 第1章 概述

### 1.1 模块定位

V12 包含两大变更：

1. **路径迁移** — 将数据目录从 `config/mcagent/` 迁移到 `Alice/`，与 AC 规范对齐，确保 AC 能正确发现实例并读取持久化数据
2. **配置接入模块** — 实现 Fabric 指令、config.json 热加载、配置变更事件推送等配置管理能力

这两个变更密切相关：路径迁移是配置接入的先决条件（确定配置文件的最终存储位置），配置接入是路径迁移后的管理入口。

### 1.2 问题分析

#### 问题1：数据目录不匹配 AC 规范

```
当前路径（JE 实现）                    AC 协议规范约定
config/mcagent/                        Alice/（协议规范第2章）
├── mcagent_instance.json               ├── mcagent_instance.json
├── mcagent.db                          ├── mcagent.db
├── config.json                         ├── config.json
├── logs/                               ├── logs/
├── world_identity.json                 └── （无对应）
└── worlds/
    └── <world>/mcagent.db
```

当前 JE 模组使用 `config/mcagent/` 作为根数据目录，但 AC 协议规范（01-通信协议规范.md）中约定的示例路径为 `<mod_data_dir>/mcagent_instance.json`。BE 版使用 `plugins/McAdapter/`，JE 版也应使用游戏根目录下的独立目录。

将路径统一为 `Alice/` 解决以下问题：
- AC 实例管理器的文件选择引导需要明确的路径约定
- 多实例场景下路径可预测
- 与 BE 版的设计哲学一致（使用独立顶层目录而非嵌套在 config 下）

#### 问题2：缺少配置管理入口

```
当前状态：
- 配置存储在 SQLite config 表中（V11 已实现 CRUD）
- 没有 Fabric 指令供管理员在线查看/修改配置
- 没有 config.json 文件热加载机制
- 配置变更无法通知 Agent Core
- 管理员需要直接操作 SQLite 数据库来改配置
```

#### 问题3：路径不一致导致 AC 连接问题

多个文件硬编码了 `config/mcagent` 路径：
- [InstanceFileGenerator.java](file:///d:/McAgent/packages/adapter-java/src/main/java/io/alice/mod/adapter/entry/InstanceFileGenerator.java) — L55: `Paths.get(gameDir, "config", "mcagent")`
- [WorldIdentity.java](file:///d:/McAgent/packages/adapter-java/src/main/java/io/alice/mod/adapter/world/WorldIdentity.java) — L43: `resolve("config/mcagent/world_identity.json")`
- [WorldContext.java](file:///d:/McAgent/packages/adapter-java/src/main/java/io/alice/mod/adapter/world/WorldContext.java) — L347: `resolve("config/mcagent")`

每次新建世界/启动服务器时，需要确保所有路径一致指向 `Alice/`。

### 1.3 目标

| 目标 | 说明 |
|------|------|
| 路径迁移 | 所有数据文件从 `config/mcagent/` 迁移到游戏根目录 `Alice/` |
| 向后兼容 | 检测旧路径，自动迁移数据到新路径 |
| Fabric 指令 | 实现 `/alice` 主命令及 `config` 子命令 |
| 配置文件热加载 | `config.json` 文件变更时自动同步到 SQLite |
| 配置变更通知 | 配置变更时通过 TCP 通知 Agent Core |
| 配置双向同步 | config.json ↔ SQLite 双向同步，保持一致 |

---

## 第2章 架构设计

### 2.1 路径迁移架构

#### 新路径约定

```
游戏根目录（<gameDir>）
├── Alice/                           ← 新根目录
│   ├── mcagent_instance.json        ← 入口文件（AC 发现用）
│   ├── world_identity.json          ← 世界身份（服务器级）
│   ├── config.json                  ← 配置文件（热加载）
│   ├── mcagent.db                   ← 全局数据库（保留备用）
│   ├── logs/                        ← 日志目录
│   └── worlds/                      ← 按世界隔离的数据库
│       └── <world_name>/
│           ├── mcagent.db           ← 该世界的 SQLite 数据库
│           └── world_identity.json  ← 世界身份（存档级）
```

#### 路径对比

| 用途 | 旧路径 (config/mcagent) | 新路径 (Alice/) |
|------|------------------------|-----------------|
| 入口 JSON | `config/mcagent/mcagent_instance.json` | `Alice/mcagent_instance.json` |
| 身份文件（服务器） | `config/mcagent/world_identity.json` | `Alice/world_identity.json` |
| 身份文件（存档） | `saves/<world>/config/mcagent/world_identity.json` | `saves/<world>/Alice/world_identity.json` |
| 世界数据库 | `config/mcagent/worlds/<world>/mcagent.db` | `Alice/worlds/<world>/mcagent.db` |
| 配置文件 | `config/mcagent/config.json` | `Alice/config.json` |
| 日志目录 | `config/mcagent/logs/` | `Alice/logs/` |

#### 迁移策略

首次启动 V12 版本时，检测旧路径 `config/mcagent/` 是否存在：

```
检测 config/mcagent/ 是否存在
    ↓
存在？
    ├─ 是 → 读取 mcagent_instance.json 中的 instance_id 和 auth_token
    │       ├─ 复制到 Alice/mcagent_instance.json（更新路径字段）
    │       ├─ 复制 config.json → Alice/config.json
    │       ├─ 复制 world_identity.json → Alice/world_identity.json
    │       ├─ 复制 worlds/ 目录 → Alice/worlds/
    │       ├─ 复制 mcagent.db → Alice/mcagent.db
    │       ├─ 复制 logs/ → Alice/logs/
    │       └─ 完成后在旧目录创建 .migrated 标记文件（防止重复迁移）
    │
    └─ 否 → 使用 Alice/ 创建新文件（正常启动流程）
```

**重要原则**：迁移只复制不删除旧文件，保证回滚安全。

### 2.2 配置接入架构

```
┌──────────────────────────────────────────────────────────────────┐
│                         Alice Mod JE                             │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │                    C8: 配置接入模块 (V12 新增)                 │ │
│  │                                                              │ │
│  │  ┌─────────────────┐   ┌─────────────────┐                  │ │
│  │  │ Fabric 指令系统   │   │ 配置文件热加载     │                  │ │
│  │  │ /alice config    │   │ FileWatcher      │                  │ │
│  │  │   get/set/list   │   │ config.json ↔ DB  │                  │ │
│  │  │ /alice status    │   │ 自动同步          │                  │ │
│  │  │ /alice reload    │   └────────┬────────┘                  │ │
│  │  └────────┬────────┘            │                            │ │
│  │           │                     │                            │ │
│  │           ▼                     ▼                            │ │
│  │  ┌─────────────────────────────────────────────────────────┐ │ │
│  │  │                    ConfigManager                         │ │ │
│  │  │  ┌──────────────────────────────────────────────────┐   │ │ │
│  │  │  │  配置缓存 (ConcurrentHashMap)                     │   │ │ │
│  │  │  │  get(key) / set(key, value) / getAll() / watch() │   │ │ │
│  │  │  └──────────────────────────────────────────────────┘   │ │ │
│  │  │                                                         │ │ │
│  │  │  变更 → 同步到 SQLite + 写入 config.json + 通知 AC      │ │ │
│  │  └──────────────────────────┬──────────────────────────────┘ │ │
│  │                             │                                │ │
│  └─────────────────────────────┼────────────────────────────────┘ │
│                                │                                  │
│                ┌───────────────┼───────────────┐                  │
│                ▼               ▼               ▼                  │
│  ┌─────────────────┐ ┌──────────────┐ ┌──────────────────┐       │
│  │  SQLite config  │ │ config.json  │ │ TCP 事件通知      │       │
│  │  ConfigRepo     │ │ 文件系统      │ │ → Agent Core     │       │
│  └─────────────────┘ └──────────────┘ └──────────────────┘       │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### 2.3 数据流

#### 配置读取优先级

```
应用启动
    ↓
ConfigManager.init()
    ├─ 1. 从 SQLite 加载所有配置到缓存
    ├─ 2. 从 config.json 加载配置
    ├─ 3. 对比两者，取 updated_at 较新的为准
    ├─ 4. 差异同步：将较新的一方写入较旧的一方
    └─ 5. 启动 FileWatcher 监听 config.json 变更
```

#### 配置写入流程

```
用户执行 /alice config set <key> <value>
    ↓
AliceCommand → ConfigManager.set(key, value)
    ↓
1. 更新内存缓存 (ConcurrentHashMap)
2. 写入 SQLite (ConfigRepository.set)
3. 写入 config.json (序列化)
4. 通过 TCP 发送 config_update 通知到 Agent Core
    ↓
Agent Core 收到 → 更新实例配置 → 返回确认
```

#### 配置文件变更检测

```
FileWatcher 检测到 config.json 变更
    ↓
延迟 500ms（防抖）→ 读取 config.json
    ↓
与内存缓存 diff
    ├─ 无差异 → 跳过（可能是自身写入的回写）
    └─ 有差异 → 更新内存缓存 + 写入 SQLite + 通知 AC
```

### 2.4 配置项定义

```json
{
  "llm": {
    "provider": "openai",
    "model": "gpt-4o",
    "api_key": "",
    "base_url": "",
    "temperature": 0.7,
    "max_tokens": 4096
  },
  "tool_permissions": {
    "mode": "allow_all",
    "allowed_tools": [],
    "blocked_tools": []
  },
  "agent": {
    "language": "zh-CN",
    "persona": {
      "name": "Alice",
      "description": "一个乐于助人的 Minecraft AI 助手"
    }
  },
  "heartbeat_interval": 10,
  "auto_reconnect": true,
  "tcp_port": 27541
}
```

### 2.5 文件变更清单

#### 路径迁移涉及的文件

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `entry/InstanceFileGenerator.java` | 修改 | 路径 `config/mcagent` → `Alice` |
| `world/WorldIdentity.java` | 修改 | 身份文件路径 `config/mcagent` → `Alice` |
| `world/WorldContext.java` | 修改 | `resolveDbPath()` 中路径 `config/mcagent` → `Alice` |
| `entry/PathMigration.java` | **新增** | 旧路径到新路径的迁移逻辑 |

#### 配置接入涉及的文件

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `config/AliceCommand.java` | **新增** | Fabric 指令 `/alice` 注册与处理 |
| `config/ConfigManager.java` | **新增** | 配置管理器（缓存 + 同步 + 通知） |
| `config/ConfigFileWatcher.java` | **新增** | config.json 文件变更监听 |
| `config/ConfigConstants.java` | **新增** | 预定义配置键与默认值 |
| `persistence/ConfigRepository.java` | 修改 | 新增 watch/callback 机制（可选） |
| `persistence/DatabaseManager.java` | 修改 | 迁移后路径更新 |

### 2.6 与 AC 的协议扩展

配置变更通知遵循 [01-通信协议规范.md](../../protocols/01-通信协议规范.md) 中定义的 `config_update` 通知格式：

```json
{
  "jsonrpc": "2.0",
  "method": "config_update",
  "params": {
    "changes": [
      { "key": "llm.model", "old_value": "gpt-4o", "new_value": "gpt-4o-mini" },
      { "key": "heartbeat_interval", "old_value": "10", "new_value": "15" }
    ],
    "source": "command"
  }
}
```

---

## 第3章 核心实现

### 3.1 路径迁移

#### 3.1.1 路径常量统一

```java
// Alice 目录路径工具类
public final class AlicePaths {

    private AlicePaths() {}

    /** Alice 数据根目录（相对于游戏根目录）。 */
    private static final String ALICE_DIR = "Alice";

    /** 世界数据子目录。 */
    private static final String WORLDS_DIR = "worlds";

    /** 入口文件名。 */
    public static final String INSTANCE_FILE = "mcagent_instance.json";

    /** 身份文件名。 */
    public static final String IDENTITY_FILE = "world_identity.json";

    /** 配置文件名。 */
    public static final String CONFIG_FILE = "config.json";

    /** 数据库文件名。 */
    public static final String DB_FILE = "mcagent.db";

    /** 日志目录名。 */
    public static final String LOGS_DIR = "logs";

    /** 旧路径（用于迁移检测）。 */
    private static final String OLD_CONFIG_DIR = "config/mcagent";

    public static Path aliceDir(Path gameDir) {
        return gameDir.resolve(ALICE_DIR);
    }

    public static Path instanceFile(Path gameDir) {
        return aliceDir(gameDir).resolve(INSTANCE_FILE);
    }

    public static Path identityFile(Path gameDir) {
        return aliceDir(gameDir).resolve(IDENTITY_FILE);
    }

    public static Path identityFileForWorld(Path gameDir, String worldName) {
        return aliceDir(gameDir).resolve(WORLDS_DIR)
                .resolve(sanitize(worldName)).resolve(IDENTITY_FILE);
    }

    public static Path worldDbPath(Path gameDir, String worldName) {
        return aliceDir(gameDir).resolve(WORLDS_DIR)
                .resolve(sanitize(worldName)).resolve(DB_FILE);
    }

    public static Path configFile(Path gameDir) {
        return aliceDir(gameDir).resolve(CONFIG_FILE);
    }

    public static Path logsDir(Path gameDir) {
        return aliceDir(gameDir).resolve(LOGS_DIR);
    }

    /** 旧路径（用于迁移检测）。 */
    public static Path oldConfigDir(Path gameDir) {
        return gameDir.resolve(OLD_CONFIG_DIR);
    }

    private static String sanitize(String name) {
        return name.replaceAll("[^a-zA-Z0-9_\\-]", "_");
    }
}
```

#### 3.1.2 迁移检测

```java
// 在 AliceModAdapter 启动时调用
public final class PathMigration {

    private static final Logger LOG = LoggerFactory.getLogger(PathMigration.class);
    private static final String MIGRATED_MARKER = ".migrated_to_alice";

    /**
     * 执行路径迁移（如果旧路径存在且未迁移过）。
     *
     * @param gameDir 游戏根目录
     * @return 是否执行了迁移
     */
    public static boolean migrateIfNeeded(Path gameDir) {
        Path oldDir = AlicePaths.oldConfigDir(gameDir);
        Path newDir = AlicePaths.aliceDir(gameDir);
        Path marker = oldDir.resolve(MIGRATED_MARKER);

        // 检查旧路径是否存在且未被迁移
        if (!Files.exists(oldDir) || Files.exists(marker)) {
            return false;
        }

        // 新路径已存在且有内容，跳过迁移
        if (Files.exists(newDir)) {
            try (var files = Files.list(newDir)) {
                if (files.findAny().isPresent()) {
                    LOG.info("New Alice directory already exists, skipping migration");
                    Files.writeString(marker, "migrated_at=" + Instant.now());
                    return false;
                }
            } catch (IOException e) {
                LOG.warn("Failed to check new directory", e);
            }
        }

        try {
            doMigrate(oldDir, newDir, marker);
            LOG.info("Path migration completed: config/mcagent/ → Alice/");
            return true;
        } catch (IOException e) {
            LOG.error("Path migration failed", e);
            return false;
        }
    }

    private static void doMigrate(Path oldDir, Path newDir, Path marker) throws IOException {
        // 复制整个目录树
        try (var stream = Files.walk(oldDir)) {
            for (Path oldPath : (Iterable<Path>) stream::iterator) {
                Path relative = oldDir.relativize(oldPath);
                Path newPath = newDir.resolve(relative.toString()
                        .replace("config/mcagent", "Alice"));
                Files.copy(oldPath, newPath, StandardCopyOption.REPLACE_EXISTING);
            }
        }

        // 创建迁移标记
        Files.writeString(marker, "migrated_at=" + Instant.now());
        LOG.info("Migration marker created: {}", marker);
    }
}
```

### 3.2 InstanceFileGenerator 修改

```java
// 修改前
Path configDir = Paths.get(gameDir, "config", "mcagent");
Path filePath = configDir.resolve("mcagent_instance.json");

// 修改后
Path aliceDir = AlicePaths.aliceDir(Paths.get(gameDir));
Path filePath = AlicePaths.instanceFile(Paths.get(gameDir));

// database 路径更新
database.addProperty("sqlite_path", AlicePaths.worldDbPath(Paths.get(gameDir), worldName).toString());
database.addProperty("config_path", AlicePaths.configFile(Paths.get(gameDir)).toString());
database.addProperty("log_path", AlicePaths.logsDir(Paths.get(gameDir)).toString());
```

### 3.3 WorldIdentity 修改

```java
// 修改前（专用服务器）
identityFile = server.getServerDirectory()
        .resolve("config/mcagent/world_identity.json");

// 修改后（专用服务器）
identityFile = AlicePaths.identityFile(server.getServerDirectory());

// 修改前（集成服务器/单人存档）
identityFile = server.getServerDirectory()
        .resolve("saves")
        .resolve(sanitizeWorldName(worldDirName))
        .resolve("config/mcagent/world_identity.json");

// 修改后（集成服务器/单人存档）
identityFile = server.getServerDirectory()
        .resolve("saves")
        .resolve(sanitizeWorldName(worldDirName))
        .resolve("Alice/world_identity.json");
```

### 3.4 WorldContext.resolveDbPath 修改

```java
// 修改前
private static Path resolveDbPath(MinecraftServer server, WorldIdentity identity) {
    Path configDir = server.getServerDirectory().resolve("config/mcagent");
    String worldDirName = sanitizeWorldName(
            server.isDedicatedServer() ? "dedicated" : server.getWorldData().getLevelName());
    return configDir.resolve("worlds").resolve(worldDirName).resolve("mcagent.db");
}

// 修改后
private static Path resolveDbPath(MinecraftServer server, WorldIdentity identity) {
    String worldDirName = sanitizeWorldName(
            server.isDedicatedServer() ? "dedicated" : server.getWorldData().getLevelName());
    return AlicePaths.worldDbPath(server.getServerDirectory(), worldDirName);
}
```

### 3.5 ConfigManager

```java
package io.alice.mod.adapter.config;

import com.google.gson.*;
import io.alice.mod.adapter.entry.AlicePaths;
import io.alice.mod.adapter.persistence.ConfigRepository;
import io.alice.mod.adapter.persistence.DatabaseManager;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.nio.file.*;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 配置管理器 — 配置缓存入口，统一管理 SQLite、config.json、内存缓存三者同步。
 *
 * <p>职责：
 * <ul>
 *   <li>维护配置的内存缓存（ConcurrentHashMap）</li>
 *   <li>协调 SQLite config 表与 config.json 文件的双向同步</li>
 *   <li>配置变更时通知 Agent Core（通过 TCP）</li>
 *   <li>启动文件监听器检测 config.json 的外部修改</li>
 * </ul>
 */
public final class ConfigManager {

    private static final Logger LOG = LoggerFactory.getLogger(ConfigManager.class);
    private static final Gson GSON = new GsonBuilder().setPrettyPrinting().disableHtmlEscaping().create();

    private final Path gameDir;
    private final DatabaseManager databaseManager;
    private final ConcurrentHashMap<String, ConfigEntry> cache = new ConcurrentHashMap<>();
    private final List<ConfigChangeListener> listeners = new ArrayList<>();

    private ConfigFileWatcher fileWatcher;

    public ConfigManager(Path gameDir, DatabaseManager databaseManager) {
        this.gameDir = gameDir;
        this.databaseManager = databaseManager;
    }

    /**
     * 初始化配置管理器。
     * <ol>
     *   <li>从 SQLite 加载配置到缓存</li>
     *   <li>从 config.json 加载配置</li>
     *   <li>对比两者，取较新值</li>
     *   <li>同步差异</li>
     *   <li>启动文件监听</li>
     * </ol>
     */
    public void init() {
        // 1. 从 SQLite 加载
        Map<String, String> dbConfig = databaseManager.configs().getAll();
        for (Map.Entry<String, String> entry : dbConfig.entrySet()) {
            cache.put(entry.getKey(), new ConfigEntry(entry.getKey(), entry.getValue(), "db"));
        }

        // 2. 从 config.json 加载
        Path configFile = AlicePaths.configFile(gameDir);
        if (Files.exists(configFile)) {
            try {
                String content = Files.readString(configFile);
                JsonObject json = GSON.fromJson(content, JsonObject.class);
                mergeFromJson(json);
            } catch (Exception e) {
                LOG.warn("Failed to load config.json, will use SQLite data", e);
            }
        }

        // 3. 同步差异（SQLite → config.json）
        syncToFile();

        // 4. 启动文件监听
        this.fileWatcher = new ConfigFileWatcher(configFile, this::onFileChanged);
        this.fileWatcher.start();

        LOG.info("ConfigManager initialized with {} entries", cache.size());
    }

    // ── 核心 API ──

    /** 获取配置值。 */
    public Optional<String> get(String key) {
        return Optional.ofNullable(cache.get(key)).map(e -> e.value);
    }

    /** 设置配置值。 */
    public void set(String key, String value) {
        set(key, value, "command");
    }

    /** 设置配置值，指定变更来源。 */
    public void set(String key, String value, String source) {
        ConfigEntry old = cache.put(key, new ConfigEntry(key, value, source));
        String oldValue = old != null ? old.value : null;

        // 同步到 SQLite
        databaseManager.configs().set(key, value);

        // 同步到 config.json
        syncToFile();

        // 通知监听器
        notifyChange(key, oldValue, value, source);
    }

    /** 获取所有配置。 */
    public Map<String, String> getAll() {
        Map<String, String> result = new LinkedHashMap<>();
        for (Map.Entry<String, ConfigEntry> entry : cache.entrySet()) {
            result.put(entry.getKey(), entry.getValue().value);
        }
        return result;
    }

    /** 注册配置变更监听器。 */
    public void addListener(ConfigChangeListener listener) {
        listeners.add(listener);
    }

    /** 关闭配置管理器。 */
    public void shutdown() {
        if (fileWatcher != null) {
            fileWatcher.stop();
        }
        syncToFile();
    }

    // ── 内部方法 ──

    private void onFileChanged() {
        Path configFile = AlicePaths.configFile(gameDir);
        try {
            String content = Files.readString(configFile);
            JsonObject json = GSON.fromJson(content, JsonObject.class);

            // diff 并与缓存合并
            List<ConfigChange> changes = mergeFromJson(json);

            // 有外部变更，同步到 SQLite
            if (!changes.isEmpty()) {
                for (ConfigChange change : changes) {
                    databaseManager.configs().set(change.key, change.newValue);
                    notifyChange(change.key, change.oldValue, change.newValue, "file_watch");
                }
                LOG.info("Config file changed externally: {} updates", changes.size());
            }
        } catch (Exception e) {
            LOG.warn("Failed to process config file change", e);
        }
    }

    private List<ConfigChange> mergeFromJson(JsonObject json) {
        List<ConfigChange> changes = new ArrayList<>();
        Map<String, String> flat = flattenJson("", json);

        for (Map.Entry<String, String> entry : flat.entrySet()) {
            String key = entry.getKey();
            String newValue = entry.getValue();
            ConfigEntry existing = cache.get(key);
            String oldValue = existing != null ? existing.value : null;

            if (!Objects.equals(oldValue, newValue)) {
                changes.add(new ConfigChange(key, oldValue, newValue));
                cache.put(key, new ConfigEntry(key, newValue, "file"));
            }
        }
        return changes;
    }

    private void syncToFile() {
        try {
            Path configFile = AlicePaths.configFile(gameDir);
            Files.createDirectories(configFile.getParent());

            // 将扁平配置转回嵌套 JSON
            JsonObject root = unflattenJson(cache);
            Files.writeString(configFile, GSON.toJson(root));
        } catch (Exception e) {
            LOG.warn("Failed to sync config to file", e);
        }
    }

    private void notifyChange(String key, String oldValue, String newValue, String source) {
        ConfigChangeEvent event = new ConfigChangeEvent(key, oldValue, newValue, source);
        for (ConfigChangeListener listener : listeners) {
            try {
                listener.onConfigChanged(event);
            } catch (Exception e) {
                LOG.warn("ConfigChangeListener error", e);
            }
        }
    }

    /** 将嵌套 JSON 展平为点分隔键。 */
    private static Map<String, String> flattenJson(String prefix, JsonObject json) {
        Map<String, String> result = new LinkedHashMap<>();
        for (Map.Entry<String, JsonElement> entry : json.entrySet()) {
            String key = prefix.isEmpty() ? entry.getKey() : prefix + "." + entry.getKey();
            JsonElement value = entry.getValue();
            if (value.isJsonObject()) {
                result.putAll(flattenJson(key, value.getAsJsonObject()));
            } else if (value.isJsonPrimitive()) {
                result.put(key, value.getAsString());
            } else {
                result.put(key, value.toString());
            }
        }
        return result;
    }

    /** 将扁平配置还原为嵌套 JSON。 */
    private static JsonObject unflattenJson(Map<String, ConfigEntry> flat) {
        JsonObject root = new JsonObject();
        for (Map.Entry<String, ConfigEntry> entry : flat.entrySet()) {
            String[] parts = entry.getKey().split("\\.");
            JsonObject current = root;
            for (int i = 0; i < parts.length - 1; i++) {
                if (!current.has(parts[i]) || !current.get(parts[i]).isJsonObject()) {
                    current.add(parts[i], new JsonObject());
                }
                current = current.getAsJsonObject(parts[i]);
            }
            current.addProperty(parts[parts.length - 1], entry.getValue().value);
        }
        return root;
    }

    // ── 内部类型 ──

    private record ConfigEntry(String key, String value, String source) {}

    public record ConfigChange(String key, String oldValue, String newValue) {}

    public record ConfigChangeEvent(String key, String oldValue, String newValue, String source) {}

    @FunctionalInterface
    public interface ConfigChangeListener {
        void onConfigChanged(ConfigChangeEvent event);
    }
}
```

### 3.6 AliceCommand（Fabric 指令）

```java
package io.alice.mod.adapter.config;

import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.arguments.StringArgumentType;
import com.mojang.brigadier.context.CommandContext;
import net.minecraft.command.CommandRegistryAccess;
import net.minecraft.server.command.ServerCommandSource;
import net.minecraft.text.Text;

import static net.minecraft.server.command.CommandManager.*;

/**
 * Alice Mod Fabric 指令注册。
 *
 * <p>子命令：
 * <ul>
 *   <li>{@code /alice config get <key>} — 获取配置</li>
 *   <li>{@code /alice config set <key> <value>} — 设置配置</li>
 *   <li>{@code /alice config list [category]} — 列出所有配置</li>
 *   <li>{@code /alice status} — 查看模组运行状态</li>
 *   <li>{@code /alice reload} — 重新加载配置</li>
 * </ul>
 */
public final class AliceCommand {

    private static final String PREFIX = "§7[§bAlice§7]§r ";

    private AliceCommand() {}

    public static void register(CommandDispatcher<ServerCommandSource> dispatcher,
                                 CommandRegistryAccess registryAccess,
                                 boolean dedicated) {
        dispatcher.register(literal("alice")
                // /alice config
                .then(literal("config")
                        .then(literal("get")
                                .then(argument("key", StringArgumentType.word())
                                        .executes(AliceCommand::executeConfigGet)))
                        .then(literal("set")
                                .then(argument("key", StringArgumentType.word())
                                        .then(argument("value", StringArgumentType.greedyString())
                                                .executes(AliceCommand::executeConfigSet))))
                        .then(literal("list")
                                .executes(AliceCommand::executeConfigList)
                                .then(argument("category", StringArgumentType.word())
                                        .executes(AliceCommand::executeConfigList))))
                // /alice status
                .then(literal("status")
                        .executes(AliceCommand::executeStatus))
                // /alice reload
                .then(literal("reload")
                        .requires(src -> src.hasPermissionLevel(2))
                        .executes(AliceCommand::executeReload))
                // /alice help
                .then(literal("help")
                        .executes(AliceCommand::executeHelp))
                .executes(AliceCommand::executeHelp)
        );
    }

    private static int executeConfigGet(CommandContext<ServerCommandSource> ctx) {
        String key = StringArgumentType.getString(ctx, "key");
        ConfigManager config = getConfigManager(ctx);

        config.get(key).ifPresentOrElse(
                value -> ctx.getSource().sendFeedback(
                        () -> Text.literal(PREFIX + "§e" + key + "§r = §a" + value), false),
                () -> ctx.getSource().sendFeedback(
                        () -> Text.literal(PREFIX + "§c配置项不存在: " + key), false)
        );
        return 1;
    }

    private static int executeConfigSet(CommandContext<ServerCommandSource> ctx) {
        // 需要 op 权限
        if (!ctx.getSource().hasPermissionLevel(2)) {
            ctx.getSource().sendFeedback(
                    () -> Text.literal(PREFIX + "§c需要 OP 权限"), false);
            return 0;
        }

        String key = StringArgumentType.getString(ctx, "key");
        String value = StringArgumentType.getString(ctx, "value");
        ConfigManager config = getConfigManager(ctx);

        config.get(key).ifPresentOrElse(
                oldValue -> {
                    config.set(key, value);
                    ctx.getSource().sendFeedback(
                            () -> Text.literal(PREFIX + "§e" + key + "§r §7" + oldValue + "§r → §a" + value), true);
                },
                () -> {
                    config.set(key, value);
                    ctx.getSource().sendFeedback(
                            () -> Text.literal(PREFIX + "§e" + key + "§r = §a" + value + " §7(新建)"), true);
                }
        );
        return 1;
    }

    private static int executeConfigList(CommandContext<ServerCommandSource> ctx) {
        ConfigManager config = getConfigManager(ctx);
        Map<String, String> all = config.getAll();

        if (all.isEmpty()) {
            ctx.getSource().sendFeedback(
                    () -> Text.literal(PREFIX + "§7暂无配置"), false);
            return 0;
        }

        ctx.getSource().sendFeedback(
                () -> Text.literal(PREFIX + "§9=== Alice 配置列表 ==="), false);
        for (Map.Entry<String, String> entry : all.entrySet()) {
            ctx.getSource().sendFeedback(
                    () -> Text.literal("  §e" + entry.getKey() + "§r = §a" + entry.getValue()), false);
        }
        ctx.getSource().sendFeedback(
                () -> Text.literal(PREFIX + "§9共 " + all.size() + " 项"), false);
        return 1;
    }

    private static int executeStatus(CommandContext<ServerCommandSource> ctx) {
        var wcm = io.alice.mod.adapter.world.WorldContextManager.getInstance();
        var active = wcm.getActive();

        if (active == null) {
            ctx.getSource().sendFeedback(
                    () -> Text.literal(PREFIX + "§cAlice Mod 未激活"), false);
            return 0;
        }

        var identity = active.getIdentity();
        var tcp = active.getTcpClient();
        var db = active.getDatabaseManager();

        ctx.getSource().sendFeedback(
                () -> Text.literal(PREFIX + "§9=== Alice Mod 状态 ==="), false);
        ctx.getSource().sendFeedback(
                () -> Text.literal("  世界: §a" + identity.worldName()), false);
        ctx.getSource().sendFeedback(
                () -> Text.literal("  实例: §7" + identity.instanceId()), false);
        ctx.getSource().sendFeedback(
                () -> Text.literal("  TCP: " + (tcp.isConnected() ? "§a已连接" : "§c未连接")), false);
        ctx.getSource().sendFeedback(
                () -> Text.literal("  数据库: " + (db.isInitialized() ? "§a已初始化" : "§c未初始化")), false);
        ctx.getSource().sendFeedback(
                () -> Text.literal("  运行时间: §a" + (active.getUptimeMs() / 1000) + "s"), false);
        ctx.getSource().sendFeedback(
                () -> Text.literal("  Bot 数量: §a" + active.getBotManager().getBotCount()), false);
        return 1;
    }

    private static int executeReload(CommandContext<ServerCommandSource> ctx) {
        ctx.getSource().sendFeedback(
                () -> Text.literal(PREFIX + "§e正在重新加载配置..."), true);
        // ConfigManager 的 FileWatcher 会自动检测变更
        ctx.getSource().sendFeedback(
                () -> Text.literal(PREFIX + "§a配置已重新加载"), true);
        return 1;
    }

    private static int executeHelp(CommandContext<ServerCommandSource> ctx) {
        ctx.getSource().sendFeedback(
                () -> Text.literal(PREFIX + "§9=== Alice Mod 指令帮助 ==="), false);
        ctx.getSource().sendFeedback(
                () -> Text.literal("  §e/alice config get <key>§r — 获取配置"), false);
        ctx.getSource().sendFeedback(
                () -> Text.literal("  §e/alice config set <key> <value>§r — 设置配置"), false);
        ctx.getSource().sendFeedback(
                () -> Text.literal("  §e/alice config list§r — 列出所有配置"), false);
        ctx.getSource().sendFeedback(
                () -> Text.literal("  §e/alice status§r — 查看模组状态"), false);
        ctx.getSource().sendFeedback(
                () -> Text.literal("  §e/alice reload§r — 重新加载配置"), false);
        return 1;
    }

    private static ConfigManager getConfigManager(CommandContext<ServerCommandSource> ctx) {
        // 从 WorldContextManager 获取 ConfigManager
        var active = io.alice.mod.adapter.world.WorldContextManager.getActive();
        if (active == null) {
            ctx.getSource().sendFeedback(
                    () -> Text.literal(PREFIX + "§cAlice Mod 未激活"), false);
            throw new RuntimeException("Alice Mod not active");
        }
        // 通过 active.getConfigManager() 获取（需在 WorldContext 中新增）
        return active.getConfigManager();
    }
}
```

### 3.7 AliceModAdapter 修改

```java
// 在 AliceModAdapter.onInitialize() 中注册指令和迁移
@Override
public void onInitialize() {
    LOG.info("Alice Mod initializing...");

    // 1. 执行路径迁移
    Path gameDir = FabricLoader.getInstance().getGameDir();
    boolean migrated = PathMigration.migrateIfNeeded(gameDir);
    if (migrated) {
        LOG.info("Path migration completed: config/mcagent/ → Alice/");
    }

    // 2. 注册 Fabric 指令
    CommandRegistrationCallback.EVENT.register(AliceCommand::register);

    // 3. 工具扫描（已有逻辑）
    ToolScanner.scan();
    ToolPluginDiscoverer.discover();

    // 4. 注册事件监听
    // ... 已有逻辑 ...
}
```

### 3.8 ConfigFileWatcher

```java
package io.alice.mod.adapter.config;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.nio.file.*;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * 配置文件变更监听器。
 * <p>
 * 监听 config.json 文件的修改事件，延迟 500ms 防抖后触发回调。
 */
public final class ConfigFileWatcher {

    private static final Logger LOG = LoggerFactory.getLogger(ConfigFileWatcher.class);
    private static final long DEBOUNCE_MS = 500;

    private final Path configFile;
    private final Runnable onChange;
    private final AtomicBoolean running = new AtomicBoolean(false);

    private Thread watchThread;
    private long lastModified = 0;

    public ConfigFileWatcher(Path configFile, Runnable onChange) {
        this.configFile = configFile;
        this.onChange = onChange;
    }

    /** 启动文件监听（在独立线程中运行）。 */
    public void start() {
        if (!running.compareAndSet(false, true)) return;

        watchThread = new Thread(this::watchLoop, "alice-config-watcher");
        watchThread.setDaemon(true);
        watchThread.start();

        LOG.info("Config file watcher started: {}", configFile);
    }

    /** 停止文件监听。 */
    public void stop() {
        running.set(false);
        if (watchThread != null) {
            watchThread.interrupt();
            watchThread = null;
        }
    }

    private void watchLoop() {
        try {
            // 确保父目录存在
            Files.createDirectories(configFile.getParent());

            WatchService watcher = FileSystems.getDefault().newWatchService();
            configFile.getParent().register(watcher,
                    StandardWatchEventKinds.ENTRY_MODIFY);

            while (running.get()) {
                WatchKey key;
                try {
                    key = watcher.poll(1000, java.util.concurrent.TimeUnit.MILLISECONDS);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    break;
                }

                if (key == null) continue;

                for (WatchEvent<?> event : key.pollEvents()) {
                    Path changed = (Path) event.context();
                    if (changed.toString().equals(configFile.getFileName().toString())) {
                        // 防抖：避免多次修改触发多次回调
                        long now = System.currentTimeMillis();
                        if (now - lastModified > DEBOUNCE_MS) {
                            lastModified = now;
                            // 延迟执行，等待文件写入完成
                            try {
                                Thread.sleep(DEBOUNCE_MS);
                            } catch (InterruptedException e) {
                                Thread.currentThread().interrupt();
                                break;
                            }
                            onChange.run();
                        }
                    }
                }

                if (!key.reset()) break;
            }

            watcher.close();
        } catch (IOException e) {
            if (running.get()) {
                LOG.warn("Config file watcher error", e);
            }
        }
    }
}
```

### 3.9 配置变更通知集成

在 `WorldContext` 初始化时，将配置变更监听器注册到 `ConfigManager`，变更时通过 TCP 通知 Agent Core：

```java
// 在 WorldContext.initialize() 中新增
configManager = new ConfigManager(server.getServerDirectory(), databaseManager);
configManager.addListener(event -> {
    // 通过 TCP 发送 config_update 通知
    JsonObject params = new JsonObject();
    JsonArray changes = new JsonArray();
    JsonObject change = new JsonObject();
    change.addProperty("key", event.key());
    change.addProperty("old_value", event.oldValue());
    change.addProperty("new_value", event.newValue());
    changes.add(change);
    params.add("changes", changes);
    params.addProperty("source", event.source());
    tcpClient.sendNotification("config_update", params);
});
configManager.init();
```

---

## 第4章 AC 连接验证

V12 开发完成后，需要验证以下 AC 连接链路：

### 4.1 验证清单

| # | 验证项 | 预期 | 检查点 |
|---|--------|------|--------|
| 1 | 路径迁移后 AC 可发现入口文件 | AC 读取 `Alice/mcagent_instance.json` | 入口文件位置正确 |
| 2 | 数据库路径正确 | `sqlite_path` 指向 `Alice/worlds/.../mcagent.db` | AC 可离线读取 |
| 3 | TCP 握手成功 | handshake 含 `world_name`，AC 返回 session_id | 协议规范 §3.4 |
| 4 | 工具注册 | register_tools 发送后收到 registered_count | 协议规范 §4.2 |
| 5 | 配置变更通知 | config_update 通知 AC 后收到确认 | 协议规范 §3.6 |
| 6 | 世界上下文切换 | world_offline/world_online 通知正常 | AC-WC 协议 |

### 4.2 协议对齐检查

| 协议项 | 规范路径 | JE V12 实现 | 状态 |
|--------|---------|-------------|:----:|
| 入口文件位置 | `Alice/mcagent_instance.json` | `Alice/mcagent_instance.json` | ✅ |
| 入口文件 schema | `schema_version`、`instance_id` 等 | 已包含全部必填字段 | ✅ |
| 握手方法 | `handshake` 含 `instance_id` + `auth_token` + `world_name` | 已实现 | ✅ |
| 工具注册 | `register_tools` + `tools` 数组 + `input_schema` | 已实现 | ✅ |
| 配置通知 | `config_update` 通知 | **新增** | 🆕 |
| 状态上报 | `status_report` 通知 | 已实现 | ✅ |
| 心跳 | `ping` → `pong` 响应 | 已实现 | ✅ |

---

## 第5章 边界与风险

| 场景 | 处理方式 |
|------|----------|
| 旧路径 `config/mcagent/` 不存在 | 直接使用 `Alice/` 创建新文件，跳过迁移 |
| 迁移中途失败 | 已复制的文件保留，标记文件未创建 → 下次启动重试 |
| 新路径 `Alice/` 已存在 | 跳过迁移，直接使用 |
| 配置写入冲突（指令 vs 外部文件同时修改） | ConfigManager 的 diff 机制检测差异，取时间戳较新的值 |
| config.json 被手动删除 | 从 SQLite 重新生成，不影响运行 |
| 网络断开时配置变更 | 缓存更新 + SQLite 写入成功，仅 TCP 通知失败（下次重连自动同步） |
| 多线程指令执行 | ConfigManager 使用 ConcurrentHashMap，线程安全 |
| FileWatcher 线程崩溃 | 仅影响热加载功能，不阻塞主模组运行 |

---

## 第6章 实施计划

### 6.1 任务分解

| 任务 | 负责人 | 预计工时 | 依赖 |
|------|--------|:--------:|------|
| 1. 路径迁移：AlicePaths 工具类 | B | 2h | 无 |
| 2. 路径迁移：PathMigration 迁移检测 | B | 3h | 任务1 |
| 3. 路径迁移：InstanceFileGenerator 修改 | B | 1h | 任务1 |
| 4. 路径迁移：WorldIdentity 修改 | B | 1h | 任务1 |
| 5. 路径迁移：WorldContext 修改 | B | 1h | 任务1 |
| 6. ConfigManager 实现 | B | 6h | 任务1 |
| 7. ConfigFileWatcher 实现 | B | 3h | 任务1 |
| 8. AliceCommand 指令注册 | B | 4h | 任务6 |
| 9. 配置变更 TCP 通知集成 | B | 2h | 任务6 + 任务8 |
| 10. AliceModAdapter 启动流程修改 | B | 2h | 任务2 + 任务8 |
| 11. 单元测试 + 集成测试 | B | 4h | 全部 |
| 12. AC 连接联调验证 | A+B | 3h | 全部 |

### 6.2 开发顺序

| 阶段 | 内容 | 产出 |
|:----:|------|------|
| 1 | 路径迁移 | `AlicePaths`、`PathMigration`、修改 3 个文件路径 |
| 2 | 配置管理核心 | `ConfigManager` + `ConfigFileWatcher` |
| 3 | Fabric 指令 | `AliceCommand` 注册 |
| 4 | TCP 集成 | `config_update` 通知 |
| 5 | 测试与联调 | 单元测试 + AC 连接验证 |

### 6.3 验收清单

| # | 验收项 | 预期 |
|---|--------|------|
| 1 | 模组启动后在 `<gameDir>/Alice/` 下生成入口文件 | ✅ / ❌ |
| 2 | 旧路径 `config/mcagent/` 的数据自动迁移到 `Alice/` | ✅ / ❌ |
| 3 | `/alice status` 显示模组运行状态 | ✅ / ❌ |
| 4 | `/alice config list` 列出所有配置 | ✅ / ❌ |
| 5 | `/alice config set <key> <value>` 更新配置并同步 | ✅ / ❌ |
| 6 | 外部修改 `config.json` 后，ConfigManager 检测到变更 | ✅ / ❌ |
| 7 | 配置变更时 AC 收到 `config_update` 通知 | ✅ / ❌ |
| 8 | AC 可正常读取 `Alice/mcagent_instance.json` 发现实例 | ✅ / ❌ |
| 9 | AC 重启后 JE 可重新注册工具 | ✅ / ❌ |

---

## 第7章 附录

### 7.1 新增文件清单

| 文件路径 | 用途 |
|----------|------|
| `config/AlicePaths.java` | Alice 目录路径常量工具类 |
| `config/PathMigration.java` | 旧路径到新路径迁移逻辑 |
| `config/ConfigManager.java` | 配置管理器 |
| `config/ConfigFileWatcher.java` | 配置文件热加载监听器 |
| `config/AliceCommand.java` | Fabric 指令注册与处理 |

### 7.2 修改文件清单

| 文件路径 | 修改内容 |
|----------|----------|
| `entry/InstanceFileGenerator.java` | 路径 `config/mcagent` → `AlicePaths` |
| `world/WorldIdentity.java` | 身份文件路径 `config/mcagent` → `AlicePaths` |
| `world/WorldContext.java` | `resolveDbPath()` 路径更新 + 新增 `ConfigManager` 初始化 |
| `persistence/DatabaseManager.java` | 可选：迁移后路径更新 |
| `AliceModAdapter.java` | 新增路径迁移调用 + 指令注册 |

### 7.3 与 AC-V18 的关联

AC-V18（工具注册持久化与变更检测）在 AC 侧实现了工具注册的持久化和变更检测。JE V12 的路径迁移确保 AC 能正确访问 JE 生成的入口文件，从而读取注册的工具列表。配置变更通知扩展了 AC-V18 的事件体系，使配置管理成为完整的双向链路。

### 7.4 与 AC-WC 的关联

路径迁移后的 `Alice/worlds/<world>/mcagent.db` 与 AC-WC（世界上下文切换）中的世界级数据隔离设计一致。AC-WC 要求每个世界有独立的执行上下文，JE V12 通过按世界隔离的数据库路径实现了这一需求。
