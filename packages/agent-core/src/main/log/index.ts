/**
 * 日志模块入口
 *
 * 初始化 Logger 及其所有 Transport（控制台、文件、SQLite）。
 * 纯后端调试模块，不接入前端 UI。
 * 使用 DatabaseManager 统一管理 SQLite 连接。
 */
import path from 'node:path'
import { app } from 'electron'
import Database from 'better-sqlite3'
import { Logger } from './logger'
import { createConsoleTransport, createFileTransport } from './transports'
import { createSqliteTransport } from './sqlite-transport'
import type { LogConfig, LogLevel, LogModule, LogEntry } from './types'
import { getDatabaseManager } from '../database'

export type { LogConfig, LogLevel, LogModule, LogEntry }
export { Logger }

let db: Database.Database | null = null
let hasRegisteredTransport = false

export function initLogger(config?: Partial<LogConfig>): Logger {
  const logger = Logger.getInstance()

  // 避免重复注册 Transport
  if (hasRegisteredTransport) {
    return logger
  }

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

  // 添加 SQLite Transport（使用 DatabaseManager 的统一连接）
  try {
    const dbManager = getDatabaseManager()
    db = dbManager.getDb()
    logger.addTransport(createSqliteTransport(db, mergedConfig))
    hasRegisteredTransport = true
  } catch (err) {
    console.error('日志 SQLite Transport 初始化失败:', err)
  }

  return logger
}

export function getLogger(): Logger {
  return Logger.getInstance()
}

export function getLogDb(): Database.Database | null {
  try {
    return getDatabaseManager().getDb()
  } catch {
    return db
  }
}

export function closeLogger(): void {
  hasRegisteredTransport = false
}