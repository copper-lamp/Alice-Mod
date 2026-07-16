/**
 * V23 汇报机制 — ReportStore（SQLite 持久化）
 *
 * agent_reports 表的 DAO，提供汇报记录的持久化。
 * 与 AgentReportBus（EventBus）配合使用：
 * - EventBus 走实时推送
 * - ReportStore 兜底重启后拉取未消费汇报
 */

import type Database from 'better-sqlite3';

/** 汇报类型 */
export type ReportType =
  | 'task_started'
  | 'task_progress'
  | 'task_milestone'
  | 'task_completed'
  | 'task_failed'
  | 'task_warning'
  | 'player_event'
  | 'world_event';

/** 汇报记录 */
export interface AgentReport {
  id: string;
  workspaceId: string;
  sourceAgentId: string;
  targetAgentId: string;
  reportType: ReportType;
  summary: string;
  details?: string;
  metadata?: Record<string, unknown>;
  requestId?: string;
  timestamp: number;
  /** 消费时间（null=未消费） */
  consumedAt?: number;
}

export class ReportStore {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /** 添加汇报 */
  append(report: AgentReport): void {
    this.db.prepare(
      `INSERT INTO agent_reports
        (id, workspace_id, source_agent_id, target_agent_id, report_type,
         summary, details, metadata_json, request_id, timestamp)
       VALUES
        (@id, @workspace_id, @source_agent_id, @target_agent_id, @report_type,
         @summary, @details, @metadata_json, @request_id, @timestamp)`,
    ).run({
      id: report.id,
      workspace_id: report.workspaceId,
      source_agent_id: report.sourceAgentId,
      target_agent_id: report.targetAgentId,
      report_type: report.reportType,
      summary: report.summary,
      details: report.details ?? null,
      metadata_json: report.metadata ? JSON.stringify(report.metadata) : null,
      request_id: report.requestId ?? null,
      timestamp: report.timestamp,
    });
  }

  /** 拉取未消费的汇报（按时间倒序，最新在前） */
  consumePending(
    targetAgentId: string,
    opts: { limit?: number; sinceTs?: number } = {},
  ): AgentReport[] {
    const limit = opts.limit ?? 20;
    const rows = opts.sinceTs
      ? this.db.prepare(
          `SELECT * FROM agent_reports
           WHERE target_agent_id = ? AND consumed_at IS NULL AND timestamp > ?
           ORDER BY timestamp DESC
           LIMIT ?`,
        ).all(targetAgentId, opts.sinceTs, limit)
      : this.db.prepare(
          `SELECT * FROM agent_reports
           WHERE target_agent_id = ? AND consumed_at IS NULL
           ORDER BY timestamp DESC
           LIMIT ?`,
        ).all(targetAgentId, limit);

    return (rows as ReportRow[]).map(rowToReport);
  }

  /** 标记已消费 */
  markConsumed(reportIds: string[]): void {
    if (reportIds.length === 0) return;
    const now = Date.now();
    const stmt = this.db.prepare(
      `UPDATE agent_reports SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL`,
    );
    for (const id of reportIds) {
      stmt.run(now, id);
    }
  }

  /** 查询特定 sourceAgent 发出的汇报（用于调试） */
  listBySource(
    sourceAgentId: string,
    opts: { limit?: number } = {},
  ): AgentReport[] {
    const limit = opts.limit ?? 20;
    const rows = this.db.prepare(
      `SELECT * FROM agent_reports
       WHERE source_agent_id = ?
       ORDER BY timestamp DESC
       LIMIT ?`,
    ).all(sourceAgentId, limit);
    return (rows as ReportRow[]).map(rowToReport);
  }
}

// ── 内部类型与转换 ──

interface ReportRow {
  id: string;
  workspace_id: string;
  source_agent_id: string;
  target_agent_id: string;
  report_type: string;
  summary: string;
  details: string | null;
  metadata_json: string | null;
  request_id: string | null;
  timestamp: number;
  consumed_at: number | null;
}

function rowToReport(row: ReportRow): AgentReport {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    sourceAgentId: row.source_agent_id,
    targetAgentId: row.target_agent_id,
    reportType: row.report_type as ReportType,
    summary: row.summary,
    details: row.details ?? undefined,
    metadata: row.metadata_json ? JSON.parse(row.metadata_json) : undefined,
    requestId: row.request_id ?? undefined,
    timestamp: row.timestamp,
    consumedAt: row.consumed_at ?? undefined,
  };
}