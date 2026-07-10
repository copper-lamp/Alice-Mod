/**
 * 日志查询 IPC Handler
 *
 * 提供后端调试 API 供主进程内部模块调用。
 * 纯后端模块，不接入渲染进程 UI。
 */
import { ipcMain } from 'electron'
import type Database from 'better-sqlite3'
import { getLogger } from '../log'
import type { LogQuery, LogQueryResult, LogEntry } from '../log/types'

let db: Database.Database | null = null

export function setLogDb(database: Database.Database): void {
  db = database
}

export function registerLogHandlers(): void {
  const logger = getLogger()

  // 查询历史日志
  ipcMain.handle('log:history', async (_event, query: LogQuery) => {
    if (!db) return { entries: [], total: 0, hasMore: false } as LogQueryResult

    const conditions: string[] = []
    const params: unknown[] = []

    if (query.level) {
      conditions.push('level = ?')
      params.push(query.level)
    }
    if (query.module) {
      conditions.push('module = ?')
      params.push(query.module)
    }
    if (query.keyword) {
      conditions.push('message LIKE ?')
      params.push(`%${query.keyword}%`)
    }
    if (query.startTime) {
      conditions.push('timestamp >= ?')
      params.push(query.startTime)
    }
    if (query.endTime) {
      conditions.push('timestamp <= ?')
      params.push(query.endTime)
    }
    if (query.workspaceId) {
      conditions.push('workspace_id = ?')
      params.push(query.workspaceId)
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const limit = query.limit || 50
    const offset = query.offset || 0

    try {
      const countRow = db.prepare(`SELECT COUNT(*) as total FROM logs ${where}`).get(...params) as { total: number }
      const rows = db.prepare(`SELECT * FROM logs ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`).all(...params, limit, offset) as Array<Record<string, unknown>>

      const entries: LogEntry[] = rows.map(row => ({
        id: row.id as number,
        timestamp: row.timestamp as number,
        level: row.level as LogEntry['level'],
        module: row.module as LogEntry['module'],
        message: row.message as string,
        metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
        requestId: row.request_id as string | undefined,
        workspaceId: row.workspace_id as string | undefined,
        toolCallId: row.tool_call_id as string | undefined,
      }))

      return {
        entries,
        total: countRow.total,
        hasMore: offset + limit < countRow.total,
      } as LogQueryResult
    } catch {
      return { entries: [], total: 0, hasMore: false } as LogQueryResult
    }
  })

  // 获取日志配置
  ipcMain.handle('log:config', async () => {
    return logger.getConfig()
  })

  // 设置日志级别
  ipcMain.handle('log:set-level', async (_event, { level }: { level: string }) => {
    logger.configure({ level: level as LogEntry['level'] })
    return { success: true }
  })

  // 清空日志
  ipcMain.handle('log:clear', async () => {
    if (db) {
      try {
        db.exec('DELETE FROM logs')
      } catch {
        // 忽略清理失败
      }
    }
    return { success: true }
  })
}