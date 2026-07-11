/**
 * WorkspaceStore — 工作区持久化存储
 *
 * 支持 workspace_meta 表的 CRUD，用于工作区列表的崩溃恢复。
 * 使用 DatabaseManager 的统一数据库连接。
 */

import type Database from 'better-sqlite3'
import { getDatabaseManager } from '../database'
import type { WorkspaceData } from './workspace'

// ════════════════════════════════════════════════════════════════
// 数据库行类型
// ════════════════════════════════════════════════════════════════

interface WorkspaceMetaRow {
  id: string
  instance_id: string
  name: string
  edition: string | null
  protocol_version: string | null
  mod_version: string | null
  source: string
  state: string
  tool_count: number
  last_online_at: number | null
  created_at: number
  updated_at: number
}

// ════════════════════════════════════════════════════════════════
// 转换函数
// ════════════════════════════════════════════════════════════════

function rowToWorkspaceData(row: WorkspaceMetaRow): WorkspaceData {
  return {
    id: row.id,
    name: row.name,
    instanceId: row.instance_id,
    connectionId: null,
    state: row.state as WorkspaceData['state'],
    edition: row.edition,
    protocolVersion: row.protocol_version,
    modVersion: row.mod_version,
    toolCount: row.tool_count,
    source: row.source as WorkspaceData['source'],
    persisted: true,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastOnlineAt: row.last_online_at,
  }
}

// ════════════════════════════════════════════════════════════════
// WorkspaceStore
// ════════════════════════════════════════════════════════════════

export class WorkspaceStore {
  private get db(): Database.Database {
    return getDatabaseManager().getDb()
  }

  /** 保存工作区元数据 */
  save(workspace: WorkspaceData): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO workspace_meta
        (id, instance_id, name, edition, protocol_version, mod_version, source, state, tool_count, last_online_at, created_at, updated_at)
      VALUES
        (@id, @instance_id, @name, @edition, @protocol_version, @mod_version, @source, @state, @tool_count, @last_online_at, @created_at, @updated_at)
    `)
    stmt.run({
      id: workspace.id,
      instance_id: workspace.instanceId,
      name: workspace.name,
      edition: workspace.edition,
      protocol_version: workspace.protocolVersion,
      mod_version: workspace.modVersion,
      source: workspace.source,
      state: workspace.state,
      tool_count: workspace.toolCount,
      last_online_at: workspace.lastOnlineAt,
      created_at: workspace.createdAt,
      updated_at: workspace.updatedAt,
    })
  }

  /** 批量保存工作区元数据 */
  saveBatch(workspaces: WorkspaceData[]): void {
    const insert = this.db.prepare(`
      INSERT OR REPLACE INTO workspace_meta
        (id, instance_id, name, edition, protocol_version, mod_version, source, state, tool_count, last_online_at, created_at, updated_at)
      VALUES
        (@id, @instance_id, @name, @edition, @protocol_version, @mod_version, @source, @state, @tool_count, @last_online_at, @created_at, @updated_at)
    `)
    const tx = this.db.transaction((items: WorkspaceMetaRow[]) => {
      for (const item of items) {
        insert.run(item)
      }
    })
    tx(workspaces.map(w => ({
      id: w.id,
      instance_id: w.instanceId,
      name: w.name,
      edition: w.edition,
      protocol_version: w.protocolVersion,
      mod_version: w.modVersion,
      source: w.source,
      state: w.state,
      tool_count: w.toolCount,
      last_online_at: w.lastOnlineAt,
      created_at: w.createdAt,
      updated_at: w.updatedAt,
    })))
  }

  /** 获取所有已持久化的工作区 */
  getAll(): WorkspaceData[] {
    const rows = this.db.prepare<unknown[], WorkspaceMetaRow>(
      'SELECT * FROM workspace_meta ORDER BY updated_at DESC',
    ).all()
    return rows.map(rowToWorkspaceData)
  }

  /** 按 ID 获取工作区 */
  getById(id: string): WorkspaceData | null {
    const row = this.db.prepare<unknown[], WorkspaceMetaRow | undefined>(
      'SELECT * FROM workspace_meta WHERE id = ?',
    ).get(id) as WorkspaceMetaRow | undefined
    return row ? rowToWorkspaceData(row) : null
  }

  /** 按 instanceId 获取工作区 */
  getByInstanceId(instanceId: string): WorkspaceData | null {
    const row = this.db.prepare<unknown[], WorkspaceMetaRow | undefined>(
      'SELECT * FROM workspace_meta WHERE instance_id = ?',
    ).get(instanceId) as WorkspaceMetaRow | undefined
    return row ? rowToWorkspaceData(row) : null
  }

  /** 更新工作区状态 */
  updateState(id: string, state: string, toolCount?: number): void {
    const updates: Record<string, unknown> = { state, updated_at: Date.now() }
    if (toolCount !== undefined) {
      updates.tool_count = toolCount
    }
    const setClauses = Object.keys(updates).map(k => `${k} = @${k}`).join(', ')
    this.db.prepare(
      `UPDATE workspace_meta SET ${setClauses} WHERE id = @id`,
    ).run({ ...updates, id })
  }

  /** 更新协议版本 */
  updateVersion(id: string, edition: string, protocolVersion: string, modVersion?: string): void {
    this.db.prepare(`
      UPDATE workspace_meta SET edition = ?, protocol_version = ?, mod_version = ?, updated_at = ? WHERE id = ?
    `).run(edition, protocolVersion, modVersion ?? null, Date.now(), id)
  }

  /** 更新最后在线时间 */
  updateLastOnline(id: string): void {
    this.db.prepare(
      'UPDATE workspace_meta SET last_online_at = ?, updated_at = ? WHERE id = ?',
    ).run(Date.now(), Date.now(), id)
  }

  /** 删除工作区 */
  delete(id: string): void {
    this.db.prepare('DELETE FROM workspace_meta WHERE id = ?').run(id)
  }
}