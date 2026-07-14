package io.alice.mod.adapter.persistence;

import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.*;

/**
 * 记忆元数据 Repository — 存储地图标记、区域标记、生物群系等空间索引数据。
 * <p>
 * 使用 Chunk-aligned grid (16×16) 空间索引策略，与全局地图索引对齐。
 * 以 Chunk 为空间索引单位，chunk_x = floor(block_x / 16)，chunk_z = floor(block_z / 16)。
 */
public final class MemoryMetaRepository {

    private final DatabaseManager db;

    MemoryMetaRepository(DatabaseManager db) {
        this.db = db;
    }

    /** 记忆元数据记录。 */
    public record MemoryMetaEntry(
            long id,
            String type,
            String name,
            String dimension,
            int chunkX,
            int chunkZ,
            String data,
            int importance,
            String tags,
            String createdAt,
            String updatedAt
    ) {}

    /**
     * 插入一条记忆元数据。
     *
     * @param entry 记录（id 字段会被忽略）
     * @return 新记录的自增 ID
     */
    public long insert(MemoryMetaEntry entry) {
        String sql = """
                INSERT INTO memory_meta (type, name, dimension, chunk_x, chunk_z,
                                         data, importance, tags)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """;
        try (PreparedStatement ps = db.getConnection().prepareStatement(sql, Statement.RETURN_GENERATED_KEYS)) {
            ps.setString(1, entry.type());
            ps.setString(2, entry.name() != null ? entry.name() : "");
            ps.setString(3, entry.dimension());
            ps.setInt(4, entry.chunkX());
            ps.setInt(5, entry.chunkZ());
            ps.setString(6, entry.data() != null ? entry.data() : "{}");
            ps.setInt(7, entry.importance());
            ps.setString(8, entry.tags() != null ? entry.tags() : "");
            ps.execute();

            try (ResultSet rs = ps.getGeneratedKeys()) {
                return rs.next() ? rs.getLong(1) : -1;
            }
        } catch (SQLException e) {
            throw new RuntimeException("Failed to insert memory meta", e);
        }
    }

    /**
     * 按 ID 更新记录。
     *
     * @param id    记录 ID
     * @param entry 新数据
     */
    public void update(long id, MemoryMetaEntry entry) {
        String sql = """
                UPDATE memory_meta SET
                    type = ?, name = ?, dimension = ?, chunk_x = ?, chunk_z = ?,
                    data = ?, importance = ?, tags = ?,
                    updated_at = datetime('now')
                WHERE id = ?
                """;
        try (PreparedStatement ps = db.getConnection().prepareStatement(sql)) {
            ps.setString(1, entry.type());
            ps.setString(2, entry.name() != null ? entry.name() : "");
            ps.setString(3, entry.dimension());
            ps.setInt(4, entry.chunkX());
            ps.setInt(5, entry.chunkZ());
            ps.setString(6, entry.data() != null ? entry.data() : "{}");
            ps.setInt(7, entry.importance());
            ps.setString(8, entry.tags() != null ? entry.tags() : "");
            ps.setLong(9, id);
            ps.execute();
        } catch (SQLException e) {
            throw new RuntimeException("Failed to update memory meta id: " + id, e);
        }
    }

    /**
     * 按 ID 删除记录。
     *
     * @param id 记录 ID
     */
    public void delete(long id) {
        String sql = "DELETE FROM memory_meta WHERE id = ?";
        try (PreparedStatement ps = db.getConnection().prepareStatement(sql)) {
            ps.setLong(1, id);
            ps.execute();
        } catch (SQLException e) {
            throw new RuntimeException("Failed to delete memory meta id: " + id, e);
        }
    }

    /**
     * 按类型查询。
     *
     * @param type 记忆类型
     * @return 匹配的记录列表
     */
    public List<MemoryMetaEntry> queryByType(String type) {
        String sql = "SELECT * FROM memory_meta WHERE type = ? ORDER BY updated_at DESC";
        return queryList(sql, ps -> ps.setString(1, type));
    }

    /**
     * 按 Chunk 范围查询（空间索引）。
     *
     * @param dimension 维度
     * @param minChunkX 最小 Chunk X
     * @param maxChunkX 最大 Chunk X
     * @param minChunkZ 最小 Chunk Z
     * @param maxChunkZ 最大 Chunk Z
     * @return 匹配的记录列表
     */
    public List<MemoryMetaEntry> queryByChunkRange(
            String dimension, int minChunkX, int maxChunkX,
            int minChunkZ, int maxChunkZ) {
        String sql = """
                SELECT * FROM memory_meta
                WHERE dimension = ?
                  AND chunk_x BETWEEN ? AND ?
                  AND chunk_z BETWEEN ? AND ?
                ORDER BY importance DESC, updated_at DESC
                """;
        return queryList(sql, ps -> {
            ps.setString(1, dimension);
            ps.setInt(2, minChunkX);
            ps.setInt(3, maxChunkX);
            ps.setInt(4, minChunkZ);
            ps.setInt(5, maxChunkZ);
        });
    }

    /**
     * 按重要性查询（>= 指定值）。
     *
     * @param minImportance 最低重要性（1-5）
     * @return 匹配的记录列表
     */
    public List<MemoryMetaEntry> queryByImportance(int minImportance) {
        String sql = "SELECT * FROM memory_meta WHERE importance >= ? ORDER BY importance DESC, updated_at DESC";
        return queryList(sql, ps -> ps.setInt(1, minImportance));
    }

    /**
     * 按标签查询（包含指定标签，逗号分隔的标签列表）。
     *
     * @param tag 标签名
     * @return 匹配的记录列表
     */
    public List<MemoryMetaEntry> queryByTag(String tag) {
        String sql = "SELECT * FROM memory_meta WHERE tags LIKE ? ORDER BY updated_at DESC";
        return queryList(sql, ps -> ps.setString(1, "%" + tag + "%"));
    }

    /**
     * 获取所有记忆条目。
     *
     * @param limit  返回条数
     * @param offset 偏移量
     * @return 记录列表
     */
    public List<MemoryMetaEntry> queryAll(long limit, long offset) {
        String sql = "SELECT * FROM memory_meta ORDER BY updated_at DESC LIMIT ? OFFSET ?";
        return queryList(sql, ps -> {
            ps.setLong(1, limit);
            ps.setLong(2, offset);
        });
    }

    /**
     * 获取总数。
     *
     * @return 记录总数
     */
    public int count() {
        String sql = "SELECT COUNT(*) FROM memory_meta";
        try (Statement stmt = db.getConnection().createStatement();
             ResultSet rs = stmt.executeQuery(sql)) {
            return rs.next() ? rs.getInt(1) : 0;
        } catch (SQLException e) {
            throw new RuntimeException("Failed to count memory meta", e);
        }
    }

    // ── 内部方法 ──

    @FunctionalInterface
    private interface ParameterSetter {
        void set(PreparedStatement ps) throws SQLException;
    }

    private List<MemoryMetaEntry> queryList(String sql, ParameterSetter setter) {
        List<MemoryMetaEntry> result = new ArrayList<>();
        try (PreparedStatement ps = db.getConnection().prepareStatement(sql)) {
            setter.set(ps);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    result.add(mapRow(rs));
                }
            }
        } catch (SQLException e) {
            throw new RuntimeException("Failed to query memory meta", e);
        }
        return result;
    }

    private MemoryMetaEntry mapRow(ResultSet rs) throws SQLException {
        return new MemoryMetaEntry(
                rs.getLong("id"),
                rs.getString("type"),
                rs.getString("name"),
                rs.getString("dimension"),
                rs.getInt("chunk_x"),
                rs.getInt("chunk_z"),
                rs.getString("data"),
                rs.getInt("importance"),
                rs.getString("tags"),
                rs.getString("created_at"),
                rs.getString("updated_at")
        );
    }
}