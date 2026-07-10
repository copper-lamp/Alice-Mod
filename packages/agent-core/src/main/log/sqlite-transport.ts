import Database from 'better-sqlite3'
import type { LogEntry, LogConfig, LogLevel } from './types'

interface LogRow {
  timestamp: number
  level: string
  module: string
  message: string
  metadata: string | null
  request_id: string | null
  workspace_id: string | null
  tool_call_id: string | null
}

export function createSqliteTransport(db: Database.Database, config: LogConfig): (entry: LogEntry) => void {
  // 启用 WAL 模式
  db.pragma('journal_mode = WAL')

  // 创建 logs 表
  db.exec(`
    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      level TEXT NOT NULL CHECK(level IN ('debug', 'info', 'warning', 'error')),
      module TEXT NOT NULL,
      message TEXT NOT NULL,
      metadata TEXT,
      request_id TEXT,
      workspace_id TEXT,
      tool_call_id TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_logs_level ON logs(level);
    CREATE INDEX IF NOT EXISTS idx_logs_module ON logs(module);
    CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp);
    CREATE INDEX IF NOT EXISTS idx_logs_workspace ON logs(workspace_id);
  `)

  const insertStmt = db.prepare(`
    INSERT INTO logs (timestamp, level, module, message, metadata, request_id, workspace_id, tool_call_id)
    VALUES (@timestamp, @level, @module, @message, @metadata, @request_id, @workspace_id, @tool_call_id)
  `)

  const batchInsert = db.transaction((rows: LogRow[]) => {
    for (const row of rows) {
      insertStmt.run(row)
    }
  })

  let buffer: LogRow[] = []
  let flushTimer: ReturnType<typeof setTimeout> | null = null

  function flush(): void {
    if (buffer.length > 0) {
      try {
        const batch = buffer.splice(0)
        batchInsert(batch)
      } catch {
        // SQLite 写入失败，降级处理
      }
    }
    if (flushTimer) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
  }

  return (entry: LogEntry) => {
    const levels: LogLevel[] = ['debug', 'info', 'warning', 'error']
    if (levels.indexOf(entry.level) < levels.indexOf(config.sqliteLevel)) return

    buffer.push({
      timestamp: entry.timestamp,
      level: entry.level,
      module: entry.module,
      message: entry.message,
      metadata: entry.metadata ? JSON.stringify(entry.metadata) : null,
      request_id: entry.requestId || null,
      workspace_id: entry.workspaceId || null,
      tool_call_id: entry.toolCallId || null,
    })

    // 批量写入触发条件：达到批量大小
    if (buffer.length >= (config.batchSize || 50)) {
      flush()
    } else if (!flushTimer) {
      // 或间隔时间到达
      flushTimer = setTimeout(flush, config.batchIntervalMs || 1000)
    }
  }
}