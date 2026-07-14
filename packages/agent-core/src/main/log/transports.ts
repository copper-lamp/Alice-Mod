import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import type { LogEntry, LogConfig, LogLevel } from './types'

/** 控制台输出 Transport */
export function createConsoleTransport(config: LogConfig): (entry: LogEntry) => void {
  const levelColors: Record<string, string> = {
    debug: '\x1b[90m',     // 灰色
    info: '\x1b[36m',      // 青色
    warning: '\x1b[33m',   // 黄色
    error: '\x1b[31m',     // 红色
  }
  const reset = '\x1b[0m'

  return (entry: LogEntry) => {
    const levels: LogLevel[] = ['debug', 'info', 'warning', 'error']
    if (levels.indexOf(entry.level) < levels.indexOf(config.consoleLevel)) return

    const color = levelColors[entry.level] || ''
    const time = new Date(entry.timestamp).toISOString().slice(11, 19)
    const module = entry.module.padEnd(10)
    // 使用 process.stdout.write 直接输出，避免 console.log 在 Windows 上的编码问题
    process.stdout.write(`${color}[${time}] [${entry.level.toUpperCase()}] [${module}] ${entry.message}${reset}\n`)
  }
}

/** 文件输出 Transport（含轮转） */
export function createFileTransport(config: LogConfig): (entry: LogEntry) => void {
  const logDir = config.fileDir || path.join(app.getPath('userData'), 'logs')
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true })
  }

  let currentDate = new Date().toISOString().slice(0, 10)
  let writeStream: fs.WriteStream | null = null
  let fileSize = 0
  let rotationCount = 0

  function getLogFilePath(): string {
    return path.join(logDir, `app-${currentDate}-${rotationCount}.log`)
  }

  function ensureStream(): fs.WriteStream {
    const filePath = getLogFilePath()
    if (writeStream && !writeStream.destroyed) {
      return writeStream
    }
    writeStream = fs.createWriteStream(filePath, { flags: 'a' })
    fileSize = fs.existsSync(filePath) ? fs.statSync(filePath).size : 0
    return writeStream
  }

  function rotateIfNeeded(): void {
    if (fileSize >= config.fileMaxSize) {
      if (writeStream) {
        writeStream.end()
        writeStream = null
      }
      rotationCount++

      // 删除超出保留数量的文件
      const maxCount = config.fileMaxCount || 5
      if (rotationCount >= maxCount) {
        for (let i = 0; i <= rotationCount - maxCount; i++) {
          const oldestPath = path.join(logDir, `app-${currentDate}-${i}.log`)
          try {
            if (fs.existsSync(oldestPath)) {
              fs.unlinkSync(oldestPath)
            }
          } catch {
            // 忽略删除失败
          }
        }
        rotationCount = maxCount - 1
      }
      fileSize = 0
    }
  }

  return (entry: LogEntry) => {
    const levels: LogLevel[] = ['debug', 'info', 'warning', 'error']
    if (levels.indexOf(entry.level) < levels.indexOf(config.fileLevel)) return

    // 检查日期变更
    const today = new Date().toISOString().slice(0, 10)
    if (today !== currentDate) {
      currentDate = today
      rotationCount = 0
      if (writeStream) {
        writeStream.end()
        writeStream = null
      }
    }

    try {
      rotateIfNeeded()
      const stream = ensureStream()
      const line = `[${new Date(entry.timestamp).toISOString()}] [${entry.level.toUpperCase()}] [${entry.module}] ${entry.message}${entry.metadata ? ' ' + JSON.stringify(entry.metadata) : ''}\n`
      stream.write(line)
      fileSize += Buffer.byteLength(line)
    } catch {
      // 文件写入失败，降级处理
    }
  }
}