/**
 * WorldStore — 世界上下文持久化存储
 *
 * 支持 world_meta 表的 CRUD，用于世界列表的崩溃恢复。
 * 使用 DatabaseManager 的统一数据库连接。
 */

import type Database from 'better-sqlite3'
import { getDatabaseManager } from '../database'
import type { WorldSessionData, WorldSessionState } from './world-session'

// ════════════════════════════════════════════════════════════════
// 数据库行类型
// ════════════════════════════════════════════════════════════════

interface WorldMetaRow {
  id: string
  workspace_id: string
  instance_id: string
  world_name: string
  state: string
  edition: string | null
  game_version: string | null
  connected_at: number | null
  last_online_at: number | null
  bot_count: number
  created_at: number
  updated_at: number
}

// ════════════════════════════════════════════════════════════════
// 转换函数
// ════════════════════════════════════════════════════════════════

function rowToWorldSessionData(row: WorldMetaRow): WorldSessionData {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    instanceId: row.instance_id,
    worldName: row.world_name,
    state: row.state as WorldSessionState,
    edition: row.edition ?? '',
    gameVersion: row.game_version ?? '',
    connectedAt: row.connected_at,
    lastOnlineAt: row.last_online_at,
    uptimeSeconds: 0,
    botCount: row.bot_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

// ════════════════════════════════════════════════════════════════
// WorldStore
// ════════════════════════════════════════════════════════════════

export class WorldStore {
  private get db(): Database.Database {
    return getDatabaseManager().getDb()
  }

  /** 保存世界上下文元数据 */
  save(data: WorldSessionData): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO world_meta
        (id, workspace_id, instance_id, world_name, state, edition, game_version,
         connected_at, last_online_at, bot_count, created_at, updated_at)
      VALUES
        (@id, @workspace_id, @instance_id, @world_name, @state, @edition, @game_version,
         @connected_at, @last_online_at, @bot_count, @created_at, @updated_at)
    `).run({
      id: data.id,
      workspace_id: data.workspaceId,
      instance_id: data.instanceId,
      world_name: data.worldName,
      state: data.state,
      edition: data.edition,
      game_version: data.gameVersion,
      connected_at: data.connectedAt,
      last_online_at: data.lastOnlineAt,
      bot_count: data.botCount,
      created_at: data.createdAt,
      updated_at: data.updatedAt,
    })
  }

  /** 获取指定工作区下的所有世界 */
  getAllByWorkspace(workspaceId: string): WorldSessionData[] {
    const rows = this.db.prepare<unknown[], WorldMetaRow>(
      'SELECT * FROM world_meta WHERE workspace_id = ? ORDER BY updated_at DESC',
    ).all(workspaceId)
    return rows.map(rowToWorldSessionData)
  }

  /** 按 ID 获取世界 */
  getById(id: string): WorldSessionData | null {
    const row = this.db.prepare<unknown[], WorldMetaRow | undefined>(
      'SELECT * FROM world_meta WHERE id = ?',
    ).get(id) as WorldMetaRow | undefined
    return row ? rowToWorldSessionData(row) : null
  }

  /** 更新世界状态 */
  updateState(id: string, state: string, botCount?: number): void {
    const updates: Record<string, unknown> = { state, updated_at: Date.now() }
    if (botCount !== undefined) {
      updates.bot_count = botCount
    }
    const setClauses = Object.keys(updates).map(k => `${k} = @${k}`).join(', ')
    this.db.prepare(
      `UPDATE world_meta SET ${setClauses} WHERE id = @id`,
    ).run({ ...updates, id })
  }

  /** 删除世界 */
  delete(id: string): void {
    this.db.prepare('DELETE FROM world_meta WHERE id = ?').run(id)
  }

  /** 删除指定工作区下的所有世界 */
  deleteByWorkspace(workspaceId: string): void {
    this.db.prepare('DELETE FROM world_meta WHERE workspace_id = ?').run(workspaceId)
  }
}