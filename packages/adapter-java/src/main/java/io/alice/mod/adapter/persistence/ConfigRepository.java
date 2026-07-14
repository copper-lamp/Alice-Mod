package io.alice.mod.adapter.persistence;

import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.*;

/**
 * 配置存储 Repository — 键值对配置的 CRUD 操作。
 * <p>
 * 配置值统一以 JSON 字符串存储，支持复杂类型。
 * 分类存储，便于按分类批量查询。
 */
public final class ConfigRepository {

    private final DatabaseManager db;

    ConfigRepository(DatabaseManager db) {
        this.db = db;
    }

    /**
     * 获取配置值。
     *
     * @param key 配置键
     * @return 配置值，如果不存在则返回 empty
     */
    public Optional<String> get(String key) {
        String sql = "SELECT value FROM config WHERE key = ?";
        try (PreparedStatement ps = db.getConnection().prepareStatement(sql)) {
            ps.setString(1, key);
            try (ResultSet rs = ps.executeQuery()) {
                if (rs.next()) {
                    return Optional.of(rs.getString("value"));
                }
            }
        } catch (SQLException e) {
            throw new RuntimeException("Failed to get config key: " + key, e);
        }
        return Optional.empty();
    }

    /**
     * 设置配置值（使用默认分类 "general"）。
     *
     * @param key   配置键
     * @param value 配置值
     */
    public void set(String key, String value) {
        set(key, value, "general", "");
    }

    /**
     * 设置配置值。
     *
     * @param key        配置键
     * @param value      配置值
     * @param category   配置分类
     * @param description 配置描述
     */
    public void set(String key, String value, String category, String description) {
        String sql = """
                INSERT INTO config (key, value, description, category, updated_at)
                VALUES (?, ?, ?, ?, datetime('now'))
                ON CONFLICT(key) DO UPDATE SET
                    value = excluded.value,
                    description = excluded.description,
                    category = excluded.category,
                    updated_at = datetime('now')
                """;
        try (PreparedStatement ps = db.getConnection().prepareStatement(sql)) {
            ps.setString(1, key);
            ps.setString(2, value);
            ps.setString(3, description);
            ps.setString(4, category);
            ps.execute();
        } catch (SQLException e) {
            throw new RuntimeException("Failed to set config key: " + key, e);
        }
    }

    /**
     * 批量设置配置。
     *
     * @param entries 配置键值对
     */
    public void setAll(Map<String, String> entries) {
        String sql = """
                INSERT INTO config (key, value, category, updated_at)
                VALUES (?, ?, 'general', datetime('now'))
                ON CONFLICT(key) DO UPDATE SET
                    value = excluded.value,
                    updated_at = datetime('now')
                """;
        try (PreparedStatement ps = db.getConnection().prepareStatement(sql)) {
            for (Map.Entry<String, String> entry : entries.entrySet()) {
                ps.setString(1, entry.getKey());
                ps.setString(2, entry.getValue());
                ps.addBatch();
            }
            ps.executeBatch();
        } catch (SQLException e) {
            throw new RuntimeException("Failed to batch set config", e);
        }
    }

    /**
     * 删除配置。
     *
     * @param key 配置键
     */
    public void remove(String key) {
        String sql = "DELETE FROM config WHERE key = ?";
        try (PreparedStatement ps = db.getConnection().prepareStatement(sql)) {
            ps.setString(1, key);
            ps.execute();
        } catch (SQLException e) {
            throw new RuntimeException("Failed to remove config key: " + key, e);
        }
    }

    /**
     * 获取指定分类的所有配置。
     *
     * @param category 配置分类
     * @return 配置键值映射
     */
    public Map<String, String> getByCategory(String category) {
        String sql = "SELECT key, value FROM config WHERE category = ?";
        Map<String, String> result = new LinkedHashMap<>();
        try (PreparedStatement ps = db.getConnection().prepareStatement(sql)) {
            ps.setString(1, category);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    result.put(rs.getString("key"), rs.getString("value"));
                }
            }
        } catch (SQLException e) {
            throw new RuntimeException("Failed to get config by category: " + category, e);
        }
        return result;
    }

    /**
     * 获取所有配置。
     *
     * @return 配置键值映射
     */
    public Map<String, String> getAll() {
        String sql = "SELECT key, value FROM config ORDER BY category, key";
        Map<String, String> result = new LinkedHashMap<>();
        try (Statement stmt = db.getConnection().createStatement();
             ResultSet rs = stmt.executeQuery(sql)) {
            while (rs.next()) {
                result.put(rs.getString("key"), rs.getString("value"));
            }
        } catch (SQLException e) {
            throw new RuntimeException("Failed to get all config", e);
        }
        return result;
    }

    /**
     * 检查配置是否存在。
     *
     * @param key 配置键
     * @return 是否存在
     */
    public boolean exists(String key) {
        String sql = "SELECT 1 FROM config WHERE key = ?";
        try (PreparedStatement ps = db.getConnection().prepareStatement(sql)) {
            ps.setString(1, key);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next();
            }
        } catch (SQLException e) {
            throw new RuntimeException("Failed to check config key: " + key, e);
        }
    }

    /**
     * 获取配置数量。
     *
     * @return 配置总数
     */
    public int count() {
        String sql = "SELECT COUNT(*) FROM config";
        try (Statement stmt = db.getConnection().createStatement();
             ResultSet rs = stmt.executeQuery(sql)) {
            return rs.next() ? rs.getInt(1) : 0;
        } catch (SQLException e) {
            throw new RuntimeException("Failed to count config", e);
        }
    }
}