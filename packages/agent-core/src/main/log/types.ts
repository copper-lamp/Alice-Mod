/** 日志级别 */
export type LogLevel = 'debug' | 'info' | 'warning' | 'error'

/** 日志模块 */
export type LogModule =
  | 'TCP' | 'LLM' | 'FCP' | 'WORKSPACE' | 'MEMORY'
  | 'TASK' | 'QQ' | 'INSTANCE' | 'PROMPT'
  | 'PIPELINE' | 'SYSTEM' | 'GENERAL' | 'TRIGGER'

/** 日志条目 */
export interface LogEntry {
  id: number
  timestamp: number
  level: LogLevel
  module: LogModule
  message: string
  metadata?: Record<string, unknown>
  requestId?: string
  workspaceId?: string
  toolCallId?: string
  stack?: string
}

/** 日志配置 */
export interface LogConfig {
  level: LogLevel
  fileLevel: LogLevel
  consoleLevel: LogLevel
  sqliteLevel: LogLevel
  fileMaxSize: number    // 字节，默认 10MB
  fileMaxCount: number   // 保留文件数，默认 5
  fileDir: string
  batchSize: number      // SQLite 批量写入条数，默认 50
  batchIntervalMs: number // 批量写入间隔，默认 1000ms
}

/** 日志查询参数 */
export interface LogQuery {
  level?: LogLevel
  module?: LogModule
  keyword?: string
  startTime?: number
  endTime?: number
  workspaceId?: string
  toolCallId?: string
  offset?: number
  limit?: number
}

/** 日志查询结果 */
export interface LogQueryResult {
  entries: LogEntry[]
  total: number
  hasMore: boolean
}