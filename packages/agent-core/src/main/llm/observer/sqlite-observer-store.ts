/**
 * SqliteObserverStore — 基于 SQLite 的 LLM 观测记录持久化存储
 *
 * 在原有 MemoryObserverStore 基础上增加 SQLite 持久化层。
 * 同时保留内存缓存以提升查询性能。
 */

import type Database from 'better-sqlite3'
import { getDatabaseManager } from '../../database'
import type { LLMCallRecord, CallRecordFilter } from '../types'

// ════════════════════════════════════════════════════════════════
// 数据库行类型
// ════════════════════════════════════════════════════════════════

interface LLMCallRow {
  id: number
  provider_id: string
  model: string
  success: number
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  duration_ms: number
  error_message: string | null
  request_id: string | null
  workspace_id: string | null
  timestamp: number
}

// ════════════════════════════════════════════════════════════════
// SqliteObserverStore
// ════════════════════════════════════════════════════════════════

export class SqliteObserverStore {
  private records: LLMCallRecord[] = []
  private maxRecords: number

  private get db(): Database.Database {
    return getDatabaseManager().getDb()
  }

  constructor(maxRecords: number = 10000) {
    this.maxRecords = maxRecords
  }

  push(record: LLMCallRecord, workspaceId?: string): void {
    // 写入内存缓存
    this.records.push(record)
    if (this.records.length > this.maxRecords) {
      this.records = this.records.slice(-this.maxRecords)
    }

    // 写入 SQLite
    try {
      this.db.prepare(`
        INSERT INTO llm_call_records
          (provider_id, model, success, prompt_tokens, completion_tokens, total_tokens,
           duration_ms, error_message, request_id, workspace_id, timestamp)
        VALUES
          (@provider_id, @model, @success, @prompt_tokens, @completion_tokens, @total_tokens,
           @duration_ms, @error_message, @request_id, @workspace_id, @timestamp)
      `).run({
        provider_id: record.providerId,
        model: record.model,
        success: record.success ? 1 : 0,
        prompt_tokens: record.promptTokens ?? 0,
        completion_tokens: record.completionTokens ?? 0,
        total_tokens: record.totalTokens ?? 0,
        duration_ms: record.durationMs,
        error_message: record.error ?? null,
        request_id: record.requestId ?? null,
        workspace_id: workspaceId ?? null,
        timestamp: record.timestamp,
      })
    } catch (err) {
      console.error('LLM 调用记录持久化失败:', err)
    }
  }

  query(filter?: CallRecordFilter): LLMCallRecord[] {
    // 优先从内存缓存查询
    let result = [...this.records]

    if (filter) {
      if (filter.providerId) {
        result = result.filter(r => r.providerId === filter.providerId)
      }
      if (filter.model) {
        result = result.filter(r => r.model === filter.model)
      }
      if (filter.success !== undefined) {
        result = result.filter(r => r.success === filter.success)
      }
      if (filter.startTime) {
        result = result.filter(r => r.timestamp >= filter.startTime!)
      }
      if (filter.endTime) {
        result = result.filter(r => r.timestamp <= filter.endTime!)
      }
      if (filter.limit) {
        const offset = filter.offset || 0
        result = result.slice(offset, offset + filter.limit)
      }
    }

    // 如果内存缓存不足，从 SQLite 补充查询
    if (result.length < (filter?.limit ?? 20)) {
      try {
        return this.queryFromSqlite(filter)
      } catch {
        return result
      }
    }

    return result
  }

  private queryFromSqlite(filter?: CallRecordFilter): LLMCallRecord[] {
    const conditions: string[] = []
    const bindings: Record<string, unknown> = {}

    if (filter?.providerId) {
      conditions.push('provider_id = @provider_id')
      bindings.provider_id = filter.providerId
    }
    if (filter?.model) {
      conditions.push('model = @model')
      bindings.model = filter.model
    }
    if (filter?.success !== undefined) {
      conditions.push('success = @success')
      bindings.success = filter.success ? 1 : 0
    }
    if (filter?.workspaceId) {
      conditions.push('workspace_id = @workspace_id')
      bindings.workspace_id = filter.workspaceId
    }
    if (filter?.startTime) {
      conditions.push('timestamp >= @start_time')
      bindings.start_time = filter.startTime
    }
    if (filter?.endTime) {
      conditions.push('timestamp <= @end_time')
      bindings.end_time = filter.endTime
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const limit = filter?.limit ?? 100
    const offset = filter?.offset ?? 0

    const rows = this.db.prepare<Record<string, unknown>, LLMCallRow>(
      `SELECT * FROM llm_call_records ${whereClause} ORDER BY timestamp DESC LIMIT @limit OFFSET @offset`,
    ).all({ ...bindings, limit, offset })

    return rows.map(rowToRecord)
  }

  getAll(): LLMCallRecord[] {
    return [...this.records]
  }

  clear(): void {
    this.records = []
    try {
      this.db.exec('DELETE FROM llm_call_records')
    } catch {
      // 忽略清理失败
    }
  }

  get length(): number {
    return this.records.length
  }
}

function rowToRecord(row: LLMCallRow): LLMCallRecord {
  return {
    providerId: row.provider_id,
    model: row.model,
    success: row.success === 1,
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    totalTokens: row.total_tokens,
    durationMs: row.duration_ms,
    finishReason: row.success === 1 ? 'stop' : 'error',
    error: row.error_message ?? undefined,
    requestId: row.request_id ?? '',
    timestamp: row.timestamp,
  }
}