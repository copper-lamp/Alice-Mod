package io.alice.mod.adapter.persistence;

import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.*;

/**
 * 事件记录 Repository — 记录游戏事件，供 LLM 回溯和分析。
 * <p>
 * 支持按事件类型、时间范围、来源查询。
 * 提供自动清理策略，防止表无限增长。
 */
public final class EventLogRepository {

    private final DatabaseManager db;

    EventLogRepository(DatabaseManager db) {
        this.db = db;
    }

    /** 事件记录。 */
    public record EventLogEntry(
            long id,
            String eventType,
            String source,
            String detail,
            String data,
            String worldName,
            String instanceId,
            String createdAt
    ) {}

    /**
     * 插入一条事件记录。
     *
     * @param entry 事件记录（id 字段会被忽略）
     * @return 新记录的自增 ID
     */
    public long insert(EventLogEntry entry) {
        String sql = """
                INSERT INTO event_logs (event_type, source, detail, data,
                                        world_name, instance_id)
                VALUES (?, ?, ?, ?, ?, ?)
                """;
        try (PreparedStatement ps = db.getConnection().prepareStatement(sql, Statement.RETURN_GENERATED_KEYS)) {
            ps.setString(1, entry.eventType());
            ps.setString(2, entry.source() != null ? entry.source() : "");
            ps.setString(3, entry.detail() != null ? entry.detail() : "");
            ps.setString(4, entry.data() != null ? entry.data() : "{}");
            ps.setString(5, entry.worldName() != null ? entry.worldName() : db.getWorldName());
            ps.setString(6, entry.instanceId() != null ? entry.instanceId() : db.getInstanceId());
            ps.execute();

            try (ResultSet rs = ps.getGeneratedKeys()) {
                return rs.next() ? rs.getLong(1) : -1;
            }
        } catch (SQLException e) {
            throw new RuntimeException("Failed to insert event log", e);
        }
    }

    /**
     * 按事件类型查询。
     *
     * @param eventType 事件类型
     * @param limit     返回条数
     * @return 事件记录列表
     */
    public List<EventLogEntry> queryByType(String eventType, long limit) {
        String sql = "SELECT * FROM event_logs WHERE event_type = ? ORDER BY id DESC LIMIT ?";
        return queryList(sql, ps -> {
            ps.setString(1, eventType);
            ps.setLong(2, limit);
        });
    }

    /**
     * 按时间范围查询（最新的在前）。
     *
     * @param limit  返回条数
     * @param offset 偏移量
     * @return 事件记录列表
     */
    public List<EventLogEntry> queryByTimeRange(long limit, long offset) {
        String sql = "SELECT * FROM event_logs ORDER BY id DESC LIMIT ? OFFSET ?";
        return queryList(sql, ps -> {
            ps.setLong(1, limit);
            ps.setLong(2, offset);
        });
    }

    /**
     * 按来源查询。
     *
     * @param source 来源（bot_name / "system" / "world_context"）
     * @param limit  返回条数
     * @return 事件记录列表
     */
    public List<EventLogEntry> queryBySource(String source, long limit) {
        String sql = "SELECT * FROM event_logs WHERE source = ? ORDER BY id DESC LIMIT ?";
        return queryList(sql, ps -> {
            ps.setString(1, source);
            ps.setLong(2, limit);
        });
    }

    /**
     * 查询最近 N 条事件。
     *
     * @param limit 返回条数
     * @return 事件记录列表
     */
    public List<EventLogEntry> queryRecent(int limit) {
        return queryByTimeRange(limit, 0);
    }

    /**
     * 获取事件总数。
     *
     * @return 事件总数
     */
    public int count() {
        String sql = "SELECT COUNT(*) FROM event_logs";
        try (Statement stmt = db.getConnection().createStatement();
             ResultSet rs = stmt.executeQuery(sql)) {
            return rs.next() ? rs.getInt(1) : 0;
        } catch (SQLException e) {
            throw new RuntimeException("Failed to count event logs", e);
        }
    }

    /**
     * 清理旧事件，保留最近 N 条。
     *
     * @param keepCount 保留条数
     * @return 删除的记录数
     */
    public int cleanOld(int keepCount) {
        String sql = "DELETE FROM event_logs WHERE id NOT IN (SELECT id FROM event_logs ORDER BY id DESC LIMIT ?)";
        try (PreparedStatement ps = db.getConnection().prepareStatement(sql)) {
            ps.setInt(1, Math.max(keepCount, 0));
            return ps.executeUpdate();
        } catch (SQLException e) {
            throw new RuntimeException("Failed to clean old event logs", e);
        }
    }

    // ── 内部方法 ──

    @FunctionalInterface
    private interface ParameterSetter {
        void set(PreparedStatement ps) throws SQLException;
    }

    private List<EventLogEntry> queryList(String sql, ParameterSetter setter) {
        List<EventLogEntry> result = new ArrayList<>();
        try (PreparedStatement ps = db.getConnection().prepareStatement(sql)) {
            setter.set(ps);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    result.add(mapRow(rs));
                }
            }
        } catch (SQLException e) {
            throw new RuntimeException("Failed to query event logs", e);
        }
        return result;
    }

    private EventLogEntry mapRow(ResultSet rs) throws SQLException {
        return new EventLogEntry(
                rs.getLong("id"),
                rs.getString("event_type"),
                rs.getString("source"),
                rs.getString("detail"),
                rs.getString("data"),
                rs.getString("world_name"),
                rs.getString("instance_id"),
                rs.getString("created_at")
        );
    }
}