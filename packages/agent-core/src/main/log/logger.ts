import { EventEmitter } from 'node:events'
import type { LogLevel, LogModule, LogEntry, LogConfig } from './types'

export type Transport = (entry: LogEntry) => void | Promise<void>

export class Logger extends EventEmitter {
  private static instance: Logger
  private transports: Transport[] = []
  private config!: LogConfig

  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger()
    }
    return Logger.instance
  }

  configure(config: Partial<LogConfig>): void {
    this.config = { ...this.config, ...config } as LogConfig
  }

  getConfig(): LogConfig {
    return this.config
  }

  addTransport(transport: Transport): void {
    this.transports.push(transport)
  }

  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ['debug', 'info', 'warning', 'error']
    return levels.indexOf(level) >= levels.indexOf(this.config.level)
  }

  private createEntry(level: LogLevel, module: LogModule, message: string, meta?: Record<string, unknown>): LogEntry {
    return {
      id: Date.now() + Math.random(),
      timestamp: Date.now(),
      level,
      module,
      message,
      metadata: meta,
      requestId: meta?.requestId as string | undefined,
      workspaceId: meta?.workspaceId as string | undefined,
      toolCallId: meta?.toolCallId as string | undefined,
    }
  }

  private async log(level: LogLevel, module: LogModule, message: string, meta?: Record<string, unknown>): Promise<void> {
    if (!this.config) return
    if (!this.shouldLog(level)) return
    const entry = this.createEntry(level, module, message, meta)
    this.emit('log', entry)
    await Promise.all(this.transports.map(t => t(entry)))
  }

  debug(module: LogModule, message: string, meta?: Record<string, unknown>): void {
    this.log('debug', module, message, meta)
  }

  info(module: LogModule, message: string, meta?: Record<string, unknown>): void {
    this.log('info', module, message, meta)
  }

  warn(module: LogModule, message: string, meta?: Record<string, unknown>): void {
    this.log('warning', module, message, meta)
  }

  error(module: LogModule, message: string, meta?: Record<string, unknown>): void {
    this.log('error', module, message, meta)
  }
}