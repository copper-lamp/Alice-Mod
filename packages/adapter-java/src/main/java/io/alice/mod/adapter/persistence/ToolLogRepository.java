package io.alice.mod.adapter.persistence;

import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.*;

/**
 * 工具执行日志 Repository — 记录每次工具调用的完整信息。
 * <p>
 * 用于调试、回溯和性能分析。
 * 支持按时间范围、工具名、世界名查询。
 */
public final class ToolLogRepository {

    private final DatabaseManager db;

    ToolLogRepository(DatabaseManager db) {
        this.db = db;
    }

    /** 工具日志记录。 */
    public record ToolLogEntry(
            long id,
            String toolName,
            String args,
            boolean success,
            String message,
            long durationMs,
            String worldName,
            String instanceId,
            String botName,
            String createdAt
    ) {}

    /**
     * 插入一条工具日志。
     *
     * @param entry 日志记录（id 字段会被忽略）
     * @return 新记录的自增 ID
     */
    public long insert(ToolLogEntry entry) {
        String sql = """
                INSERT INTO tool_logs (tool_name, args, success, message, duration_ms,
                                       world_name, instance_id, bot_name)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """;
        try (PreparedStatement ps = db.getConnection().prepareStatement(sql, Statement.RETURN_GENERATED_KEYS)) {
            ps.setString(1, entry.toolName());
            ps.setString(2, entry.args());
            ps.setInt(3, entry.success() ? 1 : 0);
            ps.setString(4, entry.message());
            ps.setLong(5, entry.durationMs());
            ps.setString(6, entry.worldName() != null ? entry.worldName() : db.getWorldName());
            ps.setString(7, entry.instanceId() != null ? entry.instanceId() : db.getInstanceId());
            ps.setString(8, entry.botName() != null ? entry.botName() : "");
            ps.execute();

            try (ResultSet rs = ps.getGeneratedKeys()) {
                return rs.next() ? rs.getLong(1) : -1;
            }
        } catch (SQLException e) {
            throw new RuntimeException("Failed to insert tool log", e);
        }
    }

    /**
     * 批量插入工具日志。
     *
     * @param entries 日志记录列表
     */
    public void insertAll(List<ToolLogEntry> entries) {
        String sql = """
                INSERT INTO tool_logs (tool_name, args, success, message, duration_ms,
                                       world_name, instance_id, bot_name)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """;
        try (PreparedStatement ps = db.getConnection().prepareStatement(sql)) {
            for (ToolLogEntry entry : entries) {
                ps.setString(1, entry.toolName());
                ps.setString(2, entry.args());
                ps.setInt(3, entry.success() ? 1 : 0);
                ps.setString(4, entry.message());
                ps.setLong(5, entry.durationMs());
                ps.setString(6, entry.worldName() != null ? entry.worldName() : db.getWorldName());
                ps.setString(7, entry.instanceId() != null ? entry.instanceId() : db.getInstanceId());
                ps.setString(8, entry.botName() != null ? entry.botName() : "");
                ps.addBatch();
            }
            ps.executeBatch();
        } catch (SQLException e) {
            throw new RuntimeException("Failed to batch insert tool logs", e);
        }
    }

    /**
     * 查询最近 N 条日志（最新的在前）。
     *
     * @param limit 返回条数
     * @return 日志记录列表
     */
    public List<ToolLogEntry> queryRecent(int limit) {
        return queryByTimeRange(limit, 0);
    }

    /**
     * 按时间范围查询（最新的在前）。
     *
     * @param limit  返回条数
     * @param offset 偏移量
     * @return 日志记录列表
     */
    public List<ToolLogEntry> queryByTimeRange(long limit, long offset) {
        String sql = "SELECT * FROM tool_logs ORDER BY id DESC LIMIT ? OFFSET ?";
        return queryList(sql, ps -> {
            ps.setLong(1, limit);
            ps.setLong(2, offset);
        });
    }

    /**
     * 按工具名查询。
     *
     * @param toolName 工具名
     * @param limit    返回条数
     * @return 日志记录列表
     */
    public List<ToolLogEntry> queryByToolName(String toolName, long limit) {
        String sql = "SELECT * FROM tool_logs WHERE tool_name = ? ORDER BY id DESC LIMIT ?";
        return queryList(sql, ps -> {
            ps.setString(1, toolName);
            ps.setLong(2, limit);
        });
    }

    /**
     * 按世界名查询。
     *
     * @param worldName 世界名
     * @param limit     返回条数
     * @return 日志记录列表
     */
    public List<ToolLogEntry> queryByWorld(String worldName, long limit) {
        String sql = "SELECT * FROM tool_logs WHERE world_name = ? ORDER BY id DESC LIMIT ?";
        return queryList(sql, ps -> {
            ps.setString(1, worldName);
            ps.setLong(2, limit);
        });
    }

    /**
     * 统计各工具调用次数。
     *
     * @return 工具名 -> 调用次数
     */
    public Map<String, Integer> countByTool() {
        String sql = "SELECT tool_name, COUNT(*) AS cnt FROM tool_logs GROUP BY tool_name ORDER BY cnt DESC";
        Map<String, Integer> result = new LinkedHashMap<>();
        try (Statement stmt = db.getConnection().createStatement();
             ResultSet rs = stmt.executeQuery(sql)) {
            while (rs.next()) {
                result.put(rs.getString("tool_name"), rs.getInt("cnt"));
            }
        } catch (SQLException e) {
            throw new RuntimeException("Failed to count tools", e);
        }
        return result;
    }

    /**
     * 获取日志总数。
     *
     * @return 日志总数
     */
    public int count() {
        String sql = "SELECT COUNT(*) FROM tool_logs";
        try (Statement stmt = db.getConnection().createStatement();
             ResultSet rs = stmt.executeQuery(sql)) {
            return rs.next() ? rs.getInt(1) : 0;
        } catch (SQLException e) {
            throw new RuntimeException("Failed to count tool logs", e);
        }
    }

    /**
     * 清理旧日志，保留最近 N 条。
     *
     * @param keepCount 保留条数
     * @return 删除的记录数
     */
    public int cleanOld(int keepCount) {
        String sql = "DELETE FROM tool_logs WHERE id NOT IN (SELECT id FROM tool_logs ORDER BY id DESC LIMIT ?)";
        try (PreparedStatement ps = db.getConnection().prepareStatement(sql)) {
            ps.setInt(1, Math.max(keepCount, 0));
            return ps.executeUpdate();
        } catch (SQLException e) {
            throw new RuntimeException("Failed to clean old tool logs", e);
        }
    }

    // ── 内部方法 ──

    @FunctionalInterface
    private interface ParameterSetter {
        void set(PreparedStatement ps) throws SQLException;
    }

    private List<ToolLogEntry> queryList(String sql, ParameterSetter setter) {
        List<ToolLogEntry> result = new ArrayList<>();
        try (PreparedStatement ps = db.getConnection().prepareStatement(sql)) {
            setter.set(ps);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    result.add(mapRow(rs));
                }
            }
        } catch (SQLException e) {
            throw new RuntimeException("Failed to query tool logs", e);
        }
        return result;
    }

    private ToolLogEntry mapRow(ResultSet rs) throws SQLException {
        return new ToolLogEntry(
                rs.getLong("id"),
                rs.getString("tool_name"),
                rs.getString("args"),
                rs.getInt("success") == 1,
                rs.getString("message"),
                rs.getLong("duration_ms"),
                rs.getString("world_name"),
                rs.getString("instance_id"),
                rs.getString("bot_name"),
                rs.getString("created_at")
        );
    }
}