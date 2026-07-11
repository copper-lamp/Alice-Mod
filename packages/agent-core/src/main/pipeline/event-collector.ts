/**
 * PipelineEventCollector — Pipeline 工具调用事件收集器
 *
 * 纯后端调试模块，监听 FunctionCallingPipeline 的事件，
 * 将工具调用数据持久化到 SQLite。
 *
 * 监听的事件：
 * - pipeline:start    → 记录 pipeline 开始
 * - pipeline:parsed   → 记录解析出的工具调用（pending 状态）
 * - pipeline:complete → 更新工具调用结果（success/error）
 * - pipeline:error    → 标记工具调用为错误状态
 */
import { EventEmitter } from 'node:events'
import Database from 'better-sqlite3'
import { PipelineEvent } from './types'
import type { ToolCallContent, PipelineResult } from './types'

/**
 * ToolCallRecord — 工具调用记录（持久化）
 */
export interface ToolCallRecord {
  id: string
  pipelineId: string
  workspaceId: string
  toolName: string
  category: string
  params: Record<string, unknown>
  result?: {
    success: boolean
    data?: unknown
    error?: string
    duration_ms: number
  }
  status: 'pending' | 'running' | 'success' | 'error'
  level: number
  parentId?: string
  timestamp: number
  completedAt?: number
}

/**
 * 工具调用统计
 */
export interface ToolCallStats {
  totalCalls: number
  successCount: number
  failCount: number
  runningCount: number
  avgDurationMs: number
  categoryBreakdown: Record<string, number>
  topCalled: { toolName: string; count: number }[]
  recentErrors: { toolName: string; error: string; timestamp: number }[]
}

/**
 * PipelineEventCollector — 收集管线事件并持久化
 *
 * 监听 FunctionCallingPipeline 的事件，将工具调用数据
 * 转换为 ToolCallRecord 格式，写入 SQLite 并输出到日志。
 * 纯后端运行，不依赖 Electron 渲染进程。
 */
export class PipelineEventCollector {
  private records: Map<string, ToolCallRecord[]> = new Map()
  private pipelineWorkspaces: Map<string, string> = new Map()  // pipelineId → workspaceId
  private db: Database.Database | null = null
  private readonly maxRecords: number

  constructor(maxRecords = 1000) {
    this.maxRecords = maxRecords
  }

  setDatabase(database: Database.Database): void {
    this.db = database
    this.initTable()
  }

  private initTable(): void {
    if (!this.db) return
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tool_call_records (
        id TEXT PRIMARY KEY,
        pipeline_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        category TEXT,
        params TEXT,
        result TEXT,
        status TEXT NOT NULL CHECK(status IN ('pending', 'running', 'success', 'error')),
        level INTEGER NOT NULL DEFAULT 0,
        parent_id TEXT,
        timestamp INTEGER NOT NULL,
        completed_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_tcr_workspace ON tool_call_records(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_tcr_pipeline ON tool_call_records(pipeline_id);
      CREATE INDEX IF NOT EXISTS idx_tcr_timestamp ON tool_call_records(timestamp);
      CREATE INDEX IF NOT EXISTS idx_tcr_status ON tool_call_records(status);
    `)
  }

  /**
   * 绑定到 Pipeline 实例
   */
  bindToPipeline(pipeline: EventEmitter): void {
    pipeline.on(PipelineEvent.Start, this.onPipelineStart.bind(this))
    pipeline.on(PipelineEvent.Parsed, this.onParsed.bind(this))
    pipeline.on(PipelineEvent.Complete, this.onComplete.bind(this))
    pipeline.on(PipelineEvent.Error, this.onError.bind(this))
  }

  /**
   * 从 Pipeline 实例解绑
   */
  unbindFromPipeline(pipeline: EventEmitter): void {
    pipeline.off(PipelineEvent.Start, this.onPipelineStart.bind(this))
    pipeline.off(PipelineEvent.Parsed, this.onParsed.bind(this))
    pipeline.off(PipelineEvent.Complete, this.onComplete.bind(this))
    pipeline.off(PipelineEvent.Error, this.onError.bind(this))
  }

  private onPipelineStart({ pipelineId, workspaceId }: { pipelineId: string; workspaceId: string }): void {
    if (!this.records.has(pipelineId)) {
      this.records.set(pipelineId, [])
    }
  }

  private onParsed({ pipelineId, calls }: { pipelineId: string; calls: ToolCallContent[] }): void {
    const records = this.records.get(pipelineId) || []
    for (const call of calls) {
      const record: ToolCallRecord = {
        id: call.toolCallId,
        pipelineId,
        workspaceId: '',
        toolName: call.toolName,
        category: '',
        params: call.arguments,
        status: 'pending',
        level: 0,
        timestamp: Date.now(),
      }
      records.push(record)
    }
    this.records.set(pipelineId, records)
  }

  private onComplete({ pipelineId, result }: { pipelineId: string; result: PipelineResult }): void {
    const records = this.records.get(pipelineId) || []
    if (records.length === 0) return

    // 用 workspaceId 填充所有记录
    // 获取 workspaceId（从第一个非空记录中取）
    const workspaceId = records.find(r => r.workspaceId)?.workspaceId || ''

    for (const toolResult of result.toolResults) {
      const index = records.findIndex(r => r.id === toolResult.toolCallId)
      if (index >= 0) {
        records[index].status = toolResult.success ? 'success' : 'error'
        if (toolResult.success || toolResult.error) {
          records[index].result = {
            success: toolResult.success,
            data: toolResult.data,
            error: toolResult.error,
            duration_ms: toolResult.durationMs,
          }
        }
        records[index].completedAt = Date.now()
        if (workspaceId) {
          records[index].workspaceId = workspaceId
        }
        // 持久化到 SQLite
        this.persistRecord(records[index])
      }
    }

    // pipeline 完成后清理内存缓存
    this.records.delete(pipelineId)
  }

  private onError({ pipelineId, error }: { pipelineId: string; error: unknown }): void {
    const records = this.records.get(pipelineId) || []
    if (records.length === 0) return

    const errorMsg = error instanceof Error ? error.message : '管线执行异常'
    const now = Date.now()

    for (const record of records) {
      if (record.status === 'pending' || record.status === 'running') {
        record.status = 'error'
        record.result = {
          success: false,
          error: errorMsg,
          duration_ms: now - record.timestamp,
        }
        record.completedAt = now
        this.persistRecord(record)
      }
    }

    this.records.delete(pipelineId)
    this.pipelineWorkspaces.delete(pipelineId)
  }

  private persistRecord(record: ToolCallRecord): void {
    if (!this.db) return
    try {
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO tool_call_records
        (id, pipeline_id, workspace_id, tool_name, category, params, result, status, level, parent_id, timestamp, completed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      stmt.run(
        record.id,
        record.pipelineId,
        record.workspaceId,
        record.toolName,
        record.category || null,
        JSON.stringify(record.params),
        record.result ? JSON.stringify(record.result) : null,
        record.status,
        record.level,
        record.parentId || null,
        record.timestamp,
        record.completedAt || null,
      )
      this.enforceRetention()
    } catch (err) {
      console.error('工具调用记录持久化失败:', err)
    }
  }

  /**
   * 清理超出保留数量的记录
   */
  private enforceRetention(): void {
    if (!this.db) return
    try {
      this.db.exec(`
        DELETE FROM tool_call_records WHERE id IN (
          SELECT id FROM tool_call_records ORDER BY timestamp DESC LIMIT -1 OFFSET ${this.maxRecords}
        )
      `)
    } catch {
      // 忽略清理失败
    }
  }

  /**
   * 从 SQLite 查询工具调用历史
   */
  getHistory(workspaceId: string, limit = 100): ToolCallRecord[] {
    if (!this.db) return []
    try {
      const rows = this.db.prepare(
        'SELECT * FROM tool_call_records WHERE workspace_id = ? ORDER BY timestamp DESC LIMIT ?',
      ).all(workspaceId, limit) as Array<Record<string, unknown>>
      return rows.map(row => this.rowToRecord(row))
    } catch {
      return []
    }
  }

  /**
   * 按 ID 查询工具调用记录
   */
  getById(toolCallId: string): ToolCallRecord | null {
    if (!this.db) return null
    try {
      const row = this.db.prepare(
        'SELECT * FROM tool_call_records WHERE id = ?',
      ).get(toolCallId) as Record<string, unknown> | undefined
      return row ? this.rowToRecord(row) : null
    } catch {
      return null
    }
  }

  /**
   * 获取工具调用统计
   */
  getStats(workspaceId: string): ToolCallStats {
    if (!this.db) {
      return {
        totalCalls: 0, successCount: 0, failCount: 0, runningCount: 0,
        avgDurationMs: 0, categoryBreakdown: {}, topCalled: [], recentErrors: [],
      }
    }

    try {
      const records = this.getHistory(workspaceId, 1000)
      const success = records.filter(r => r.status === 'success')
      const failed = records.filter(r => r.status === 'error')
      const running = records.filter(r => r.status === 'running')

      const categoryBreakdown: Record<string, number> = {}
      for (const r of records) {
        if (r.category) {
          categoryBreakdown[r.category] = (categoryBreakdown[r.category] || 0) + 1
        }
      }

      const recentErrors = failed.slice(0, 10).map(r => ({
        toolName: r.toolName,
        error: r.result?.error || '未知错误',
        timestamp: r.timestamp,
      }))

      const toolCounts = new Map<string, number>()
      for (const r of records) {
        toolCounts.set(r.toolName, (toolCounts.get(r.toolName) || 0) + 1)
      }
      const topCalled = Array.from(toolCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([toolName, count]) => ({ toolName, count }))

      const totalDuration = records.filter(r => r.result?.duration_ms).reduce((sum, r) => sum + (r.result?.duration_ms || 0), 0)
      const completedCount = success.length + failed.length

      return {
        totalCalls: records.length,
        successCount: success.length,
        failCount: failed.length,
        runningCount: running.length,
        avgDurationMs: completedCount > 0 ? Math.round(totalDuration / completedCount) : 0,
        categoryBreakdown,
        topCalled,
        recentErrors,
      }
    } catch {
      return {
        totalCalls: 0, successCount: 0, failCount: 0, runningCount: 0,
        avgDurationMs: 0, categoryBreakdown: {}, topCalled: [], recentErrors: [],
      }
    }
  }

  /**
   * 清空指定工作区的记录
   */
  clear(workspaceId: string): void {
    if (!this.db) return
    try {
      this.db.prepare('DELETE FROM tool_call_records WHERE workspace_id = ?').run(workspaceId)
    } catch {
      // 忽略清理失败
    }
  }

  private rowToRecord(row: Record<string, unknown>): ToolCallRecord {
    return {
      id: row.id as string,
      pipelineId: row.pipeline_id as string,
      workspaceId: row.workspace_id as string,
      toolName: row.tool_name as string,
      category: (row.category as string) || '',
      params: row.params ? JSON.parse(row.params as string) : {},
      result: row.result ? JSON.parse(row.result as string) : undefined,
      status: row.status as 'pending' | 'running' | 'success' | 'error',
      level: row.level as number,
      parentId: row.parent_id as string | undefined,
      timestamp: row.timestamp as number,
      completedAt: row.completed_at as number | undefined,
    }
  }
}