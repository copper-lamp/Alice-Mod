/**
 * 日志模块入口
 *
 * 初始化 Logger 及其所有 Transport（控制台、文件、SQLite）。
 * 纯后端调试模块，不接入前端 UI。
 */
import path from 'node:path'
import { app } from 'electron'
import Database from 'better-sqlite3'
import { Logger } from './logger'
import { createConsoleTransport, createFileTransport } from './transports'
import { createSqliteTransport } from './sqlite-transport'
import type { LogConfig, LogLevel, LogModule, LogEntry } from './types'

export type { LogConfig, LogLevel, LogModule, LogEntry }
export { Logger }

let db: Database.Database | null = null

export function initLogger(config?: Partial<LogConfig>): Logger {
  const logger = Logger.getInstance()

  const defaultConfig: LogConfig = {
    level: 'debug',
    fileLevel: 'info',
    consoleLevel: 'debug',
    sqliteLevel: 'info',
    fileMaxSize: 10 * 1024 * 1024,  // 10MB
    fileMaxCount: 5,
    fileDir: '',
    batchSize: 50,
    batchIntervalMs: 1000,
  }

  const mergedConfig = { ...defaultConfig, ...config }
  logger.configure(mergedConfig)

  // 添加控制台 Transport
  logger.addTransport(createConsoleTransport(mergedConfig))

  // 添加文件 Transport
  logger.addTransport(createFileTransport(mergedConfig))

  // 添加 SQLite Transport
  try {
    const dbPath = app.getPath('userData')
    db = new Database(path.join(dbPath, 'mcagent.db'))
    logger.addTransport(createSqliteTransport(db, mergedConfig))
  } catch (err) {
    console.error('日志 SQLite 初始化失败:', err)
  }

  return logger
}

export function getLogger(): Logger {
  return Logger.getInstance()
}

export function getLogDb(): Database.Database | null {
  return db
}

export function closeLogger(): void {
  if (db) {
    db.close()
    db = null
  }
}