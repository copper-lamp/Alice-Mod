package io.alice.mod.adapter.config;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * 配置管理器 — 配置缓存入口，统一管理 SQLite、config.json、内存缓存三者同步。
 *
 * <p>职责：
 * <ul>
 *   <li>维护配置的内存缓存（ConcurrentHashMap）</li>
 *   <li>协调 SQLite config 表与 {@code config.json} 文件的双向同步</li>
 *   <li>配置变更时通知注册的监听器（通过 TCP 通知 Agent Core）</li>
 *   <li>启动文件监听器检测 {@code config.json} 的外部修改</li>
 * </ul>
 *
 * <p>使用方式：
 * <pre>{@code
 * ConfigManager cm = new ConfigManager(gameDir, databaseManager);
 * cm.init();                    // 加载配置并启动监听
 * cm.set("llm.model", "gpt-4"); // 写入配置（自动同步 SQLite + 文件）
 * String val = cm.get("llm.model").orElse("default"); // 读取配置
 * cm.shutdown();                // 关闭时停止监听
 * }</pre>
 */
public final class ConfigManager {

    private static final Logger LOG = LoggerFactory.getLogger(ConfigManager.class);

    private static final Gson GSON = new GsonBuilder()
            .setPrettyPrinting()
            .disableHtmlEscaping()
            .create();

    private final Path gameDir;
    private final ConfigRepositoryProxy db;
    private final ConcurrentHashMap<String, ConfigEntry> cache = new ConcurrentHashMap<>();
    private final List<ConfigChangeListener> listeners = new CopyOnWriteArrayList<>();

    private ConfigFileWatcher fileWatcher;

    /**
     * ConfigRepository 的简单代理接口，隔离对具体 Repository 的依赖。
     */
    public interface ConfigRepositoryProxy {
        /** 获取所有配置。 */
        Map<String, String> getAll();
        /** 设置配置值。 */
        void set(String key, String value);
    }

    /**
     * 构造配置管理器。
     *
     * @param gameDir 游戏根目录
     * @param db      SQLite 配置存储代理
     */
    public ConfigManager(Path gameDir, ConfigRepositoryProxy db) {
        this.gameDir = Objects.requireNonNull(gameDir, "gameDir");
        this.db = Objects.requireNonNull(db, "db");
    }

    /**
     * 初始化配置管理器。
     *
     * <ol>
     *   <li>从 SQLite 加载所有配置到内存缓存</li>
     *   <li>从 {@code config.json} 加载配置并合并</li>
     *   <li>将合并后的配置同步到 {@code config.json}</li>
     *   <li>启动文件监听器</li>
     * </ol>
     */
    public void init() {
        // 1. 从 SQLite 加载
        Map<String, String> dbConfig = db.getAll();
        for (Map.Entry<String, String> entry : dbConfig.entrySet()) {
            cache.put(entry.getKey(), new ConfigEntry(entry.getKey(), entry.getValue(), "db"));
        }
        LOG.debug("Loaded {} config entries from SQLite", dbConfig.size());

        // 2. 从 config.json 加载并合并
        Path configFile = AlicePaths.configFile(gameDir);
        if (Files.exists(configFile)) {
            try {
                String content = Files.readString(configFile);
                JsonObject json = GSON.fromJson(content, JsonObject.class);
                mergeFromJson(json);
                LOG.debug("Loaded and merged config from {}", configFile);
            } catch (Exception e) {
                LOG.warn("Failed to load config.json, will use SQLite data only", e);
            }
        }

        // 3. 将缓存写回 config.json（确保一致）
        syncToFile();

        // 4. 启动文件监听
        this.fileWatcher = new ConfigFileWatcher(configFile, this::onFileChanged);
        this.fileWatcher.start();

        int count = cache.size();
        LOG.info("ConfigManager initialized with {} entries, watching: {}", count, configFile);
    }

    // ── 核心 API ──

    /**
     * 获取配置值。
     *
     * @param key 配置键（点分隔，如 "llm.model"）
     * @return 配置值，不存在则返回 empty
     */
    public Optional<String> get(String key) {
        return Optional.ofNullable(cache.get(key)).map(e -> e.value);
    }

    /**
     * 设置配置值，变更来源为 "command"。
     *
     * @param key   配置键
     * @param value 配置值
     */
    public void set(String key, String value) {
        set(key, value, "command");
    }

    /**
     * 设置配置值，指定变更来源。
     * <p>
     * 自动同步到 SQLite 和 config.json，并通知监听器。
     *
     * @param key    配置键
     * @param value  配置值
     * @param source 变更来源（"command" / "file_watch" / "system"）
     */
    public void set(String key, String value, String source) {
        ConfigEntry old = cache.put(key, new ConfigEntry(key, value, source));
        String oldValue = old != null ? old.value : null;

        // 同步到 SQLite
        try {
            db.set(key, value);
        } catch (Exception e) {
            LOG.warn("Failed to sync config '{}' to SQLite", key, e);
        }

        // 同步到 config.json
        syncToFile();

        // 通知监听器
        if (!Objects.equals(oldValue, value)) {
            notifyChange(key, oldValue, value, source);
        }
    }

    /**
     * 获取所有配置的只读视图。
     *
     * @return 配置键值映射（按插入顺序）
     */
    public Map<String, String> getAll() {
        Map<String, String> result = new LinkedHashMap<>();
        for (Map.Entry<String, ConfigEntry> entry : cache.entrySet()) {
            result.put(entry.getKey(), entry.getValue().value);
        }
        return Collections.unmodifiableMap(result);
    }

    /**
     * 注册配置变更监听器。
     *
     * @param listener 监听器，每次配置变更时被调用
     */
    public void addListener(ConfigChangeListener listener) {
        listeners.add(listener);
    }

    /**
     * 移除配置变更监听器。
     *
     * @param listener 要移除的监听器
     */
    public void removeListener(ConfigChangeListener listener) {
        listeners.remove(listener);
    }

    /**
     * 关闭配置管理器。
     * <ul>
     *   <li>停止文件监听器</li>
     *   <li>将缓存同步到文件</li>
     * </ul>
     */
    public void shutdown() {
        if (fileWatcher != null) {
            fileWatcher.stop();
            fileWatcher = null;
        }
        syncToFile();
        LOG.info("ConfigManager shut down");
    }

    // ── 内部方法 ──

    /** 文件变更回调（由 ConfigFileWatcher 触发）。 */
    private void onFileChanged() {
        Path configFile = AlicePaths.configFile(gameDir);
        if (!Files.exists(configFile)) {
            return;
        }

        try {
            String content = Files.readString(configFile);
            JsonObject json = GSON.fromJson(content, JsonObject.class);

            // diff 并与缓存合并
            List<ConfigChange> changes = mergeFromJson(json);

            // 有外部变更，同步到 SQLite
            if (!changes.isEmpty()) {
                for (ConfigChange change : changes) {
                    db.set(change.key, change.newValue);
                    notifyChange(change.key, change.oldValue, change.newValue, "file_watch");
                }
                LOG.info("Config file changed externally: {} update(s)", changes.size());
            }
        } catch (Exception e) {
            LOG.warn("Failed to process config file change", e);
        }
    }

    /**
     * 将 JSON 对象的配置合并到缓存。
     *
     * @param json config.json 的 JSON 对象
     * @return 检测到的变更列表
     */
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

    /** 将内存缓存写回 config.json。 */
    private void syncToFile() {
        try {
            Path configFile = AlicePaths.configFile(gameDir);
            Files.createDirectories(configFile.getParent());

            JsonObject root = unflattenJson(cache);
            Files.writeString(configFile, GSON.toJson(root));
        } catch (Exception e) {
            LOG.warn("Failed to sync config to file", e);
        }
    }

    /** 通知所有监听器配置变更。 */
    private void notifyChange(String key, String oldValue, String newValue, String source) {
        ConfigChangeEvent event = new ConfigChangeEvent(key, oldValue, newValue, source);
        for (ConfigChangeListener listener : listeners) {
            try {
                listener.onConfigChanged(event);
            } catch (Exception e) {
                LOG.warn("ConfigChangeListener error for key '{}'", key, e);
            }
        }
    }

    /**
     * 将嵌套 JSON 展平为点分隔键。
     * <p>
     * 例如：{ "llm": { "model": "gpt-4" } } → { "llm.model": "gpt-4" }
     */
    static Map<String, String> flattenJson(String prefix, JsonObject json) {
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

    /**
     * 将扁平配置还原为嵌套 JSON。
     * <p>
     * 例如：{ "llm.model": "gpt-4" } → { "llm": { "model": "gpt-4" } }
     */
    static JsonObject unflattenJson(Map<String, ConfigEntry> flat) {
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

    /** 缓存条目。 */
    private record ConfigEntry(String key, String value, String source) {}

    /** 配置变更描述。 */
    public record ConfigChange(String key, String oldValue, String newValue) {}

    /** 配置变更事件。 */
    public record ConfigChangeEvent(String key, String oldValue, String newValue, String source) {

        /** 是否有实际值变化（null → 非 null 或值不同）。 */
        public boolean hasChanged() {
            return !Objects.equals(oldValue, newValue);
        }
    }

    /** 配置变更监听器。 */
    @FunctionalInterface
    public interface ConfigChangeListener {
        /** 配置变更时回调。 */
        void onConfigChanged(ConfigChangeEvent event);
    }
}
