/**
 * V20 主链路组装 — ChatHistoryStore
 *
 * chat_history 表的 DAO，提供对话历史持久化。
 *
 * 表结构见 database-manager.ts 内联 schema（V20 加 §4.6 一节）。
 * 索引：
 *   idx_chat_history_lookup(workspace_id, agent_id, created_at DESC)
 *   idx_chat_history_event(event_id)
 */

import type Database from 'better-sqlite3';
import type { ToolCallPart } from '../prompt/types';

/** 对话历史记录 */
export interface ChatHistoryEntry {
  id?: number;
  workspaceId: string;
  agentId: string;
  /** 触发来源 */
  source: 'trigger' | 'qq' | 'debug' | 'system';
  /** 关联的 trigger event id（可空） */
  eventId?: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** assistant 消息带的 tool_calls（role='assistant' 时可空） */
  toolCalls?: ToolCallPart[];
  /** tool 消息的关联 tool_call_id（role='tool' 时可空） */
  toolCallId?: string;
  /** 估算的 token 数（可空，由 BaseProvider.usage 回填） */
  tokenCount?: number;
  /** LLM finish_reason（仅 role='assistant' 有用） */
  finishReason?: 'stop' | 'length' | 'tool_calls' | 'error';
  createdAt: number;
}

export interface ChatHistoryLoadOptions {
  /** 返回最新 N 条，默认 60 */
  limit?: number;
  /** 返回 id < beforeId 的记录（用于分页） */
  beforeId?: number;
}

export interface ChatHistoryStats {
  total: number;
  oldestAt: number;
  totalTokens: number;
}

export interface ChatHistoryStore {
  append(entry: ChatHistoryEntry): Promise<number>;
  load(
    workspaceId: string,
    agentId: string,
    opts?: ChatHistoryLoadOptions,
  ): Promise<ChatHistoryEntry[]>;
  clear(
    workspaceId: string,
    agentId: string,
    opts?: { beforeId?: number },
  ): Promise<number>;
  getStats(workspaceId: string, agentId: string): Promise<ChatHistoryStats>;
}

/** SQLite 实现 */
export class SqliteChatHistoryStore implements ChatHistoryStore {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /** 切换底层 DB 实例（主要用于测试） */
  setDb(db: Database.Database): void {
    this.db = db;
  }

  async append(entry: ChatHistoryEntry): Promise<number> {
    const now = entry.createdAt ?? Date.now();
    const result = this.db.prepare(
      `INSERT INTO chat_history
        (workspace_id, agent_id, source, event_id, role, content,
         tool_calls_json, tool_call_id, token_count, finish_reason, created_at)
       VALUES
        (@workspace_id, @agent_id, @source, @event_id, @role, @content,
         @tool_calls_json, @tool_call_id, @token_count, @finish_reason, @created_at)`,
    ).run({
      workspace_id: entry.workspaceId,
      agent_id: entry.agentId,
      source: entry.source,
      event_id: entry.eventId ?? null,
      role: entry.role,
      content: entry.content,
      tool_calls_json: entry.toolCalls ? JSON.stringify(entry.toolCalls) : null,
      tool_call_id: entry.toolCallId ?? null,
      token_count: entry.tokenCount ?? null,
      finish_reason: entry.finishReason ?? null,
      created_at: now,
    });
    return Number(result.lastInsertRowid);
  }

  async load(
    workspaceId: string,
    agentId: string,
    opts: ChatHistoryLoadOptions = {},
  ): Promise<ChatHistoryEntry[]> {
    const limit = Math.max(1, opts.limit ?? 60);
    const beforeId = opts.beforeId;

    const rows = beforeId
      ? this.db.prepare(
          `SELECT * FROM chat_history
           WHERE workspace_id = ? AND agent_id = ? AND id < ?
           ORDER BY created_at DESC
           LIMIT ?`,
        ).all(workspaceId, agentId, beforeId, limit) as ChatHistoryRow[]
      : this.db.prepare(
          `SELECT * FROM chat_history
           WHERE workspace_id = ? AND agent_id = ?
           ORDER BY created_at DESC
           LIMIT ?`,
        ).all(workspaceId, agentId, limit) as ChatHistoryRow[];

    // 时间倒序取的，load 出来按时间正序返回（便于 MainAgent 拼到 history 数组）
    return rows.reverse().map(rowToEntry);
  }

  async clear(
    workspaceId: string,
    agentId: string,
    opts: { beforeId?: number } = {},
  ): Promise<number> {
    const result = opts.beforeId
      ? this.db.prepare(
          `DELETE FROM chat_history
           WHERE workspace_id = ? AND agent_id = ? AND id < ?`,
        ).run(workspaceId, agentId, opts.beforeId)
      : this.db.prepare(
          `DELETE FROM chat_history WHERE workspace_id = ? AND agent_id = ?`,
        ).run(workspaceId, agentId);
    return Number(result.changes);
  }

  async getStats(workspaceId: string, agentId: string): Promise<ChatHistoryStats> {
    const row = this.db.prepare(
      `SELECT
         COUNT(*) as total,
         MIN(created_at) as oldest_at,
         COALESCE(SUM(token_count), 0) as total_tokens
       FROM chat_history
       WHERE workspace_id = ? AND agent_id = ?`,
    ).get(workspaceId, agentId) as
      | { total: number; oldest_at: number | null; total_tokens: number | null }
      | undefined;

    return {
      total: row?.total ?? 0,
      oldestAt: row?.oldest_at ?? 0,
      totalTokens: row?.total_tokens ?? 0,
    };
  }
}

// ── 内部类型与转换 ──

interface ChatHistoryRow {
  id: number;
  workspace_id: string;
  agent_id: string;
  source: string;
  event_id: string | null;
  role: string;
  content: string;
  tool_calls_json: string | null;
  tool_call_id: string | null;
  token_count: number | null;
  finish_reason: string | null;
  created_at: number;
}

function rowToEntry(row: ChatHistoryRow): ChatHistoryEntry {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    agentId: row.agent_id,
    source: row.source as ChatHistoryEntry['source'],
    eventId: row.event_id ?? undefined,
    role: row.role as ChatHistoryEntry['role'],
    content: row.content,
    toolCalls: row.tool_calls_json ? JSON.parse(row.tool_calls_json) : undefined,
    toolCallId: row.tool_call_id ?? undefined,
    tokenCount: row.token_count ?? undefined,
    finishReason: (row.finish_reason ?? undefined) as ChatHistoryEntry['finishReason'],
    createdAt: row.created_at,
  };
}
