/**
 * SQLiteStore — 记忆结构化存储
 *
 * 基于 better-sqlite3 实现 memory_meta / memory_tags / memory_access_log 三张表的 CRUD。
 * 所有方法均同步执行（better-sqlite3 同步 API）。
 */

import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Memory, MemoryType, MemoryBranch, RecallParams, ListParams, ForgetByParams, MemoryStats } from './types'

// ════════════════════════════════════════════════════════════════
// 内部类型：数据库行（snake_case ↔ camelCase 转换桥接）
// ════════════════════════════════════════════════════════════════

interface MemoryMetaRow {
  id: string
  workspace_id: string
  type: string
  branch: string
  content_json: string
  tags: string
  importance: number
  access_count: number
  embedding_id: string | null
  created_at: number
  updated_at: number
  expires_at: number | null
}

interface TagRow {
  memory_id: string
  tag: string
}

// ════════════════════════════════════════════════════════════════
// 转换函数
// ════════════════════════════════════════════════════════════════

function rowToMemory(row: MemoryMetaRow): Memory {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    type: row.type as MemoryType,
    branch: row.branch as MemoryBranch,
    content: JSON.parse(row.content_json),
    tags: JSON.parse(row.tags) as string[],
    importance: row.importance,
    accessCount: row.access_count,
    embeddingId: row.embedding_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
  }
}

function memoryToRow(memory: Memory): MemoryMetaRow {
  return {
    id: memory.id,
    workspace_id: memory.workspaceId,
    type: memory.type,
    branch: memory.branch,
    content_json: JSON.stringify(memory.content),
    tags: JSON.stringify(memory.tags),
    importance: memory.importance,
    access_count: memory.accessCount,
    embedding_id: memory.embeddingId,
    created_at: memory.createdAt,
    updated_at: memory.updatedAt,
    expires_at: memory.expiresAt,
  }
}

// ════════════════════════════════════════════════════════════════
// SQLiteStore 类
// ════════════════════════════════════════════════════════════════

export interface ISQLiteStore {
  init(): void
  saveMeta(memory: Memory): void
  saveMetaBatch(memories: Memory[]): void
  query(params: RecallParams): { memories: Memory[]; total: number; limit: number; offset: number }
  getById(id: string): Memory | null
  getByIds(ids: string[]): Memory[]
  updateMeta(id: string, updates: Partial<Memory>): void
  deleteMeta(id: string): void
  deleteBy(params: ForgetByParams): string[]
  addTag(memoryId: string, tag: string): void
  removeTag(memoryId: string, tag: string): void
  getByTag(tag: string, limit?: number): Memory[]
  stats(): MemoryStats
  getAllIds(): string[]
  getUnembedded(limit?: number): Memory[]
  markEmbedded(id: string, embeddingId: string): void
  queryAll<T = Record<string, unknown>>(sql: string, params?: Record<string, unknown>): T[]
  run(sql: string, params?: Record<string, unknown>): void
  close(): void
}

export class SQLiteStore implements ISQLiteStore {
  private db: Database.Database

  // ── 预编译语句 ──
  private stmtInsertMeta: Database.Statement<MemoryMetaRow>
  private stmtGetById: Database.Statement<{ id: string }>
  private stmtUpdateMeta: Database.Statement<Partial<MemoryMetaRow> & { id: string }>
  private stmtDeleteMeta: Database.Statement<{ id: string }>
  private stmtInsertTag: Database.Statement<{ memory_id: string; tag: string }>
  private stmtDeleteTag: Database.Statement<{ memory_id: string; tag: string }>
  private stmtDeleteTagsByMemory: Database.Statement<{ memory_id: string }>
  private stmtInsertAccessLog: Database.Statement<{ memory_id: string; accessed_at: number; source: string }>
  private stmtCountByType: Database.Statement<{ workspace_id: string }>
  private stmtCountByBranch: Database.Statement<{ workspace_id: string }>

  // ── 事务 ──
  private txBatchInsert: (rows: MemoryMetaRow[]) => void

  constructor(dbPath: string) {
    this.db = new Database(dbPath)

    // 启用 WAL 模式
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')

    // 初始化表结构
    this.initSchema()

    // 预编译语句
    this.stmtInsertMeta = this.db.prepare(`
      INSERT INTO memory_meta (id, workspace_id, type, branch, content_json, tags, importance, access_count, embedding_id, created_at, updated_at, expires_at)
      VALUES (@id, @workspace_id, @type, @branch, @content_json, @tags, @importance, @access_count, @embedding_id, @created_at, @updated_at, @expires_at)
    `)

    this.stmtGetById = this.db.prepare(`
      SELECT * FROM memory_meta WHERE id = @id
    `)

    this.stmtUpdateMeta = this.db.prepare(`
      UPDATE memory_meta SET
        type = @type,
        branch = @branch,
        content_json = @content_json,
        tags = @tags,
        importance = @importance,
        access_count = @access_count,
        embedding_id = @embedding_id,
        updated_at = @updated_at,
        expires_at = @expires_at
      WHERE id = @id
    `)

    this.stmtDeleteMeta = this.db.prepare(`
      DELETE FROM memory_meta WHERE id = @id
    `)

    this.stmtInsertTag = this.db.prepare(`
      INSERT OR IGNORE INTO memory_tags (memory_id, tag) VALUES (@memory_id, @tag)
    `)

    this.stmtDeleteTag = this.db.prepare(`
      DELETE FROM memory_tags WHERE memory_id = @memory_id AND tag = @tag
    `)

    this.stmtDeleteTagsByMemory = this.db.prepare(`
      DELETE FROM memory_tags WHERE memory_id = @memory_id
    `)

    this.stmtInsertAccessLog = this.db.prepare(`
      INSERT INTO memory_access_log (memory_id, accessed_at, source) VALUES (@memory_id, @accessed_at, @source)
    `)

    this.stmtCountByType = this.db.prepare(`
      SELECT type, COUNT(*) as count FROM memory_meta WHERE workspace_id = @workspace_id GROUP BY type
    `)

    this.stmtCountByBranch = this.db.prepare(`
      SELECT branch, COUNT(*) as count FROM memory_meta WHERE workspace_id = @workspace_id GROUP BY branch
    `)

    // 事务：批量插入
    this.txBatchInsert = this.db.transaction((rows: MemoryMetaRow[]) => {
      for (const row of rows) {
        this.stmtInsertMeta.run(row)
      }
    })
  }

  // ══════════════════════════════════════════════════════════════
  // 初始化
  // ══════════════════════════════════════════════════════════════

  private initSchema(): void {
    const schemaPath = join(__dirname, 'schema.sql')
    let ddl: string
    try {
      ddl = readFileSync(schemaPath, 'utf-8')
    } catch {
      // 回退：内联 DDL（避免文件读取失败时无法初始化）
      ddl = `
        CREATE TABLE IF NOT EXISTS memory_meta (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          type TEXT NOT NULL,
          branch TEXT NOT NULL DEFAULT 'experience',
          content_json TEXT NOT NULL,
          tags TEXT NOT NULL DEFAULT '[]',
          importance INTEGER NOT NULL DEFAULT 5 CHECK(importance >= 1 AND importance <= 10),
          access_count INTEGER NOT NULL DEFAULT 0,
          embedding_id TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          expires_at INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_memory_meta_workspace ON memory_meta(workspace_id);
        CREATE INDEX IF NOT EXISTS idx_memory_meta_type ON memory_meta(type);
        CREATE INDEX IF NOT EXISTS idx_memory_meta_branch ON memory_meta(branch);
        CREATE INDEX IF NOT EXISTS idx_memory_meta_importance ON memory_meta(importance);
        CREATE INDEX IF NOT EXISTS idx_memory_meta_created_at ON memory_meta(created_at);
        CREATE INDEX IF NOT EXISTS idx_memory_meta_updated_at ON memory_meta(updated_at);
        CREATE INDEX IF NOT EXISTS idx_memory_meta_expires_at ON memory_meta(expires_at);
        CREATE INDEX IF NOT EXISTS idx_memory_meta_embedding ON memory_meta(embedding_id);

        CREATE TABLE IF NOT EXISTS memory_tags (
          memory_id TEXT NOT NULL,
          tag TEXT NOT NULL,
          PRIMARY KEY (memory_id, tag),
          FOREIGN KEY (memory_id) REFERENCES memory_meta(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_memory_tags_tag ON memory_tags(tag);

        CREATE TABLE IF NOT EXISTS memory_access_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          memory_id TEXT NOT NULL,
          accessed_at INTEGER NOT NULL,
          source TEXT NOT NULL DEFAULT 'llm',
          FOREIGN KEY (memory_id) REFERENCES memory_meta(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_memory_access_log_memory_id ON memory_access_log(memory_id);
        CREATE INDEX IF NOT EXISTS idx_memory_access_log_accessed_at ON memory_access_log(accessed_at);
      `
    }
    this.db.exec(ddl)
  }

  init(): void {
    // initSchema 已在构造函数中调用，此方法供外部显式初始化
    this.db.exec('SELECT 1')
  }

  // ══════════════════════════════════════════════════════════════
  // CRUD
  // ══════════════════════════════════════════════════════════════

  saveMeta(memory: Memory): void {
    const row = memoryToRow(memory)
    this.stmtInsertMeta.run(row)
    // 同步写入标签表
    for (const tag of memory.tags) {
      this.stmtInsertTag.run({ memory_id: memory.id, tag })
    }
  }

  saveMetaBatch(memories: Memory[]): void {
    const rows = memories.map(memoryToRow)
    this.txBatchInsert(rows)
    // 批量写入标签
    const insertTag = this.db.prepare<{ memory_id: string; tag: string }>(
      'INSERT OR IGNORE INTO memory_tags (memory_id, tag) VALUES (@memory_id, @tag)',
    )
    const txTags = this.db.transaction((items: Array<{ memory_id: string; tag: string }>) => {
      for (const item of items) {
        insertTag.run(item)
      }
    })
    const allTags = memories.flatMap(m => m.tags.map(tag => ({ memory_id: m.id, tag })))
    if (allTags.length > 0) {
      txTags(allTags)
    }
  }

  getById(id: string): Memory | null {
    const row = this.stmtGetById.get({ id }) as MemoryMetaRow | undefined
    if (!row) return null
    return rowToMemory(row)
  }

  getByIds(ids: string[]): Memory[] {
    if (ids.length === 0) return []
    const placeholders = ids.map(() => '?').join(',')
    const rows = this.db.prepare<unknown[], MemoryMetaRow>(
      `SELECT * FROM memory_meta WHERE id IN (${placeholders})`,
    ).all(...ids)
    return rows.map(rowToMemory)
  }

  updateMeta(id: string, updates: Partial<Memory>): void {
    const existing = this.getById(id)
    if (!existing) return

    const merged: Memory = { ...existing, ...updates, id, updatedAt: Date.now() }
    merged.tags = updates.tags ?? existing.tags
    merged.content = updates.content ?? existing.content

    const row = memoryToRow(merged)
    this.stmtUpdateMeta.run({
      id: row.id,
      type: row.type,
      branch: row.branch,
      content_json: row.content_json,
      tags: row.tags,
      importance: row.importance,
      access_count: row.access_count,
      embedding_id: row.embedding_id,
      updated_at: row.updated_at,
      expires_at: row.expires_at,
    })

    // 如果标签有变化，同步更新标签表
    if (updates.tags) {
      this.stmtDeleteTagsByMemory.run({ memory_id: id })
      for (const tag of updates.tags) {
        this.stmtInsertTag.run({ memory_id: id, tag })
      }
    }
  }

  deleteMeta(id: string): void {
    // CASCADE 会自动删除 memory_tags 和 memory_access_log 中的关联记录
    this.stmtDeleteMeta.run({ id })
  }

  deleteBy(params: ForgetByParams): string[] {
    const conditions: string[] = []
    const bindings: Record<string, unknown> = {}

    if (params.type) {
      conditions.push('type = @type')
      bindings.type = params.type
    }
    if (params.branch) {
      conditions.push('branch = @branch')
      bindings.branch = params.branch
    }
    if (params.workspaceId) {
      conditions.push('workspace_id = @workspace_id')
      bindings.workspace_id = params.workspaceId
    }
    if (params.minImportance !== undefined) {
      conditions.push('importance <= @min_importance')
      bindings.min_importance = params.minImportance
    }
    if (params.olderThan) {
      conditions.push('created_at < @older_than')
      bindings.older_than = params.olderThan
    }
    if (params.tags && params.tags.length > 0) {
      // 通过子查询匹配标签
      const tagPlaceholders = params.tags.map((t, i) => {
        bindings[`tag_${i}`] = t
        return `@tag_${i}`
      }).join(',')
      conditions.push(`id IN (SELECT memory_id FROM memory_tags WHERE tag IN (${tagPlaceholders}))`)
    }

    if (conditions.length === 0) return []

    const whereClause = conditions.join(' AND ')
    const rows = this.db.prepare<Record<string, unknown>, MemoryMetaRow>(
      `SELECT id FROM memory_meta WHERE ${whereClause}`,
    ).all(bindings)

    const ids = rows.map(r => r.id)
    if (ids.length === 0) return []

    // 批量删除
    const deleteStmt = this.db.prepare<{ id: string }>('DELETE FROM memory_meta WHERE id = @id')
    const txDelete = this.db.transaction((deleteIds: string[]) => {
      for (const did of deleteIds) {
        deleteStmt.run({ id: did })
      }
    })
    txDelete(ids)

    return ids
  }

  // ══════════════════════════════════════════════════════════════
  // 查询
  // ══════════════════════════════════════════════════════════════

  query(params: RecallParams): { memories: Memory[]; total: number; limit: number; offset: number } {
    const conditions: string[] = []
    const bindings: Record<string, unknown> = {}

    // 精确 ID 查询（优先）
    if (params.id) {
      const row = this.stmtGetById.get({ id: params.id }) as MemoryMetaRow | undefined
      if (!row) return { memories: [], total: 0, limit: 1, offset: 0 }
      return { memories: [rowToMemory(row)], total: 1, limit: 1, offset: 0 }
    }

    if (params.workspaceId) {
      conditions.push('workspace_id = @workspace_id')
      bindings.workspace_id = params.workspaceId
    }
    if (params.type) {
      conditions.push('type = @type')
      bindings.type = params.type
    }
    if (params.branch) {
      conditions.push('branch = @branch')
      bindings.branch = params.branch
    }
    if (params.minImportance !== undefined) {
      conditions.push('importance >= @min_importance')
      bindings.min_importance = params.minImportance
    }
    if (params.keywords && params.keywords.length > 0) {
      const keywordConditions = params.keywords.map((kw, i) => {
        bindings[`keyword_${i}`] = `%${kw}%`
        return `content_json LIKE @keyword_${i}`
      })
      conditions.push(`(${keywordConditions.join(' OR ')})`)
    }
    if (params.tags && params.tags.length > 0) {
      const tagConditions = params.tags.map((t, i) => {
        bindings[`tag_${i}`] = t
        return `@tag_${i}`
      }).join(',')
      conditions.push(`id IN (SELECT memory_id FROM memory_tags WHERE tag IN (${tagConditions}))`)
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    // 排序
    const orderField = params.orderBy ?? 'created_at'
    const orderDir = params.orderDir ?? 'desc'
    const orderClause = `ORDER BY ${orderField} ${orderDir}`

    const limit = params.limit ?? 20
    const offset = params.offset ?? 0

    // 总数查询
    const countRow = this.db.prepare<Record<string, unknown>, { count: number }>(
      `SELECT COUNT(*) as count FROM memory_meta ${whereClause}`,
    ).get(bindings)
    const total = countRow?.count ?? 0

    // 分页查询
    const rows = this.db.prepare<Record<string, unknown>, MemoryMetaRow>(
      `SELECT * FROM memory_meta ${whereClause} ${orderClause} LIMIT @limit OFFSET @offset`,
    ).all({ ...bindings, limit, offset })

    return {
      memories: rows.map(rowToMemory),
      total,
      limit,
      offset,
    }
  }

  list(params: ListParams): { memories: Memory[]; total: number; limit: number; offset: number } {
    return this.query(params as RecallParams)
  }

  getAllIds(): string[] {
    const rows = this.db.prepare<unknown[], { id: string }>('SELECT id FROM memory_meta').all()
    return rows.map(r => r.id)
  }

  getUnembedded(limit?: number): Memory[] {
    const query = 'SELECT * FROM memory_meta WHERE embedding_id IS NULL ORDER BY created_at ASC'
    if (limit) {
      const rows = this.db.prepare<{ limit: number }, MemoryMetaRow>(
        `${query} LIMIT @limit`,
      ).all({ limit })
      return rows.map(rowToMemory)
    }
    const rows = this.db.prepare<unknown[], MemoryMetaRow>(query).all()
    return rows.map(rowToMemory)
  }

  // ══════════════════════════════════════════════════════════════
  // MapIndex 兼容接口
  // ══════════════════════════════════════════════════════════════

  queryAll<T = Record<string, unknown>>(sql: string, params?: Record<string, unknown>): T[] {
    const stmt = this.db.prepare<Record<string, unknown>, T>(sql)
    const bindings = (params && Object.keys(params).length > 0) ? params : ({} as Record<string, unknown>)
    return stmt.all(bindings) as T[]
  }

  run(sql: string, params?: Record<string, unknown>): void {
    this.db.prepare(sql).run(params ?? ({} as Record<string, unknown>))
  }

  // ══════════════════════════════════════════════════════════════
  // 标签管理
  // ══════════════════════════════════════════════════════════════

  addTag(memoryId: string, tag: string): void {
    this.stmtInsertTag.run({ memory_id: memoryId, tag })
    // 同步更新 memory_meta 的 tags 字段
    this.syncTagsField(memoryId)
  }

  removeTag(memoryId: string, tag: string): void {
    this.stmtDeleteTag.run({ memory_id: memoryId, tag })
    // 同步更新 memory_meta 的 tags 字段
    this.syncTagsField(memoryId)
  }

  getByTag(tag: string, limit?: number): Memory[] {
    let query = 'SELECT m.* FROM memory_meta m INNER JOIN memory_tags t ON m.id = t.memory_id WHERE t.tag = @tag ORDER BY m.created_at DESC'
    if (limit) {
      query += ' LIMIT @limit'
      const rows = this.db.prepare<{ tag: string; limit: number }, MemoryMetaRow>(query).all({ tag, limit })
      return rows.map(rowToMemory)
    }
    const rows = this.db.prepare<{ tag: string }, MemoryMetaRow>(query).all({ tag })
    return rows.map(rowToMemory)
  }

  /**
   * 同步 memory_meta.tags 字段（从 memory_tags 表重新聚合）
   */
  private syncTagsField(memoryId: string): void {
    const tagRows = this.db.prepare<{ memory_id: string }, TagRow>(
      'SELECT tag FROM memory_tags WHERE memory_id = @memory_id',
    ).all({ memory_id: memoryId })
    const tags = tagRows.map(r => r.tag)
    this.db.prepare<{ tags: string; memory_id: string }>(
      'UPDATE memory_meta SET tags = @tags WHERE id = @memory_id',
    ).run({ tags: JSON.stringify(tags), memory_id: memoryId })
  }

  // ══════════════════════════════════════════════════════════════
  // 统计
  // ══════════════════════════════════════════════════════════════

  stats(workspaceId?: string): MemoryStats {
    const whereClause = workspaceId ? 'WHERE workspace_id = @workspace_id' : ''
    const bindings = workspaceId ? { workspace_id: workspaceId } : {}

    // 总数
    const totalRow = this.db.prepare<Record<string, unknown>, { count: number }>(
      `SELECT COUNT(*) as count FROM memory_meta ${whereClause}`,
    ).get(bindings)
    const total = totalRow?.count ?? 0

    // 按类型分布
    const byTypeRows = this.db.prepare<Record<string, unknown>, { type: string; count: number }>(
      `SELECT type, COUNT(*) as count FROM memory_meta ${whereClause} GROUP BY type`,
    ).all(bindings)
    const byType: Partial<Record<string, number>> = {}
    for (const r of byTypeRows) {
      byType[r.type] = r.count
    }

    // 按分支分布
    const byBranchRows = this.db.prepare<Record<string, unknown>, { branch: string; count: number }>(
      `SELECT branch, COUNT(*) as count FROM memory_meta ${whereClause} GROUP BY branch`,
    ).all(bindings)
    const byBranch: Partial<Record<string, number>> = {}
    for (const r of byBranchRows) {
      byBranch[r.branch] = r.count
    }

    // 标签总数
    const tagCountRow = this.db.prepare<Record<string, unknown>, { count: number }>(
      `SELECT COUNT(DISTINCT tag) as count FROM memory_tags ${workspaceId ? 'WHERE memory_id IN (SELECT id FROM memory_meta WHERE workspace_id = @workspace_id)' : ''}`,
    ).get(bindings)
    const totalTags = tagCountRow?.count ?? 0

    // 平均重要度
    const avgRow = this.db.prepare<Record<string, unknown>, { avg: number | null }>(
      `SELECT AVG(importance) as avg FROM memory_meta ${whereClause}`,
    ).get(bindings)
    const averageImportance = avgRow?.avg != null ? Math.round(avgRow.avg * 10) / 10 : 0

    // 最旧/最新
    const oldestRow = this.db.prepare<Record<string, unknown>, { ts: number | null }>(
      `SELECT MIN(created_at) as ts FROM memory_meta ${whereClause}`,
    ).get(bindings)
    const newestRow = this.db.prepare<Record<string, unknown>, { ts: number | null }>(
      `SELECT MAX(created_at) as ts FROM memory_meta ${whereClause}`,
    ).get(bindings)

    // 未嵌入数
    const unembeddedRow = this.db.prepare<Record<string, unknown>, { count: number }>(
      `SELECT COUNT(*) as count FROM memory_meta ${whereClause ? whereClause + ' AND' : 'WHERE'} embedding_id IS NULL`,
    ).get(bindings)

    return {
      total,
      byType: byType as Partial<Record<MemoryType, number>>,
      byBranch: byBranch as Partial<Record<MemoryBranch, number>>,
      totalTags,
      averageImportance,
      oldestMemory: oldestRow?.ts ?? 0,
      newestMemory: newestRow?.ts ?? 0,
      unembeddedCount: unembeddedRow?.count ?? 0,
    }
  }

  // ══════════════════════════════════════════════════════════════
  // 嵌入管理
  // ══════════════════════════════════════════════════════════════

  markEmbedded(id: string, embeddingId: string): void {
    this.db.prepare<{ embedding_id: string; id: string; updated_at: number }>(
      'UPDATE memory_meta SET embedding_id = @embedding_id, updated_at = @updated_at WHERE id = @id',
    ).run({ embedding_id: embeddingId, id, updated_at: Date.now() })
  }

  // ══════════════════════════════════════════════════════════════
  // 生命周期
  // ══════════════════════════════════════════════════════════════

  close(): void {
    this.db.close()
  }
}