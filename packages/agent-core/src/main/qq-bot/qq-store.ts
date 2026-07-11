/**
 * QQStore — QQ 机器人持久化存储
 *
 * 支持 qq_bot_config 和 qq_msg_history 表的 CRUD。
 * 使用 DatabaseManager 的统一数据库连接。
 */

import type Database from 'better-sqlite3'
import { getDatabaseManager } from '../database'

// ════════════════════════════════════════════════════════════════
// 类型定义
// ════════════════════════════════════════════════════════════════

export interface QQBotConfig {
  configKey: string
  configValue: Record<string, unknown>
  updatedAt: number
}

export interface QQMsgRecord {
  id?: number
  msgId?: string
  type: 'group' | 'private'
  groupId?: string
  userId: string
  userName: string
  content: string
  direction: 'incoming' | 'outgoing'
  timestamp: number
}

// ════════════════════════════════════════════════════════════════
// QQStore
// ════════════════════════════════════════════════════════════════

export class QQStore {
  private get db(): Database.Database {
    return getDatabaseManager().getDb()
  }

  // ── 配置管理 ──

  /** 保存配置 */
  setConfig(configKey: string, configValue: Record<string, unknown>): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO qq_bot_config (config_key, config_value, updated_at)
      VALUES (?, ?, ?)
    `).run(configKey, JSON.stringify(configValue), Date.now())
  }

  /** 获取配置 */
  getConfig(configKey: string): QQBotConfig | null {
    const row = this.db.prepare<unknown[], Record<string, unknown> | undefined>(
      'SELECT config_key, config_value, updated_at FROM qq_bot_config WHERE config_key = ?',
    ).get(configKey) as { config_key: string; config_value: string; updated_at: number } | undefined
    if (!row) return null
    return {
      configKey: row.config_key,
      configValue: JSON.parse(row.config_value),
      updatedAt: row.updated_at,
    }
  }

  /** 获取所有配置 */
  getAllConfigs(): QQBotConfig[] {
    const rows = this.db.prepare<unknown[], Record<string, unknown>>(
      'SELECT config_key, config_value, updated_at FROM qq_bot_config ORDER BY config_key',
    ).all() as Array<{ config_key: string; config_value: string; updated_at: number }>
    return rows.map(row => ({
      configKey: row.config_key,
      configValue: JSON.parse(row.config_value),
      updatedAt: row.updated_at,
    }))
  }

  /** 删除配置 */
  deleteConfig(configKey: string): void {
    this.db.prepare('DELETE FROM qq_bot_config WHERE config_key = ?').run(configKey)
  }

  // ── 消息历史 ──

  /** 保存消息记录 */
  saveMsg(msg: QQMsgRecord): void {
    this.db.prepare(`
      INSERT INTO qq_msg_history (msg_id, type, group_id, user_id, user_name, content, direction, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      msg.msgId ?? null,
      msg.type,
      msg.groupId ?? null,
      msg.userId,
      msg.userName,
      msg.content,
      msg.direction,
      msg.timestamp,
    )
  }

  /** 批量保存消息记录 */
  saveMsgBatch(msgs: QQMsgRecord[]): void {
    const insert = this.db.prepare(`
      INSERT INTO qq_msg_history (msg_id, type, group_id, user_id, user_name, content, direction, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const tx = this.db.transaction(() => {
      for (const msg of msgs) {
        insert.run(
          msg.msgId ?? null,
          msg.type,
          msg.groupId ?? null,
          msg.userId,
          msg.userName,
          msg.content,
          msg.direction,
          msg.timestamp,
        )
      }
    })
    tx()
  }

  /** 查询消息历史 */
  queryMsgs(params: {
    type?: 'group' | 'private'
    groupId?: string
    userId?: string
    limit?: number
    offset?: number
  }): QQMsgRecord[] {
    const conditions: string[] = []
    const bindings: Record<string, unknown> = {}

    if (params.type) {
      conditions.push('type = @type')
      bindings.type = params.type
    }
    if (params.groupId) {
      conditions.push('group_id = @group_id')
      bindings.group_id = params.groupId
    }
    if (params.userId) {
      conditions.push('user_id = @user_id')
      bindings.user_id = params.userId
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const limit = params.limit ?? 50
    const offset = params.offset ?? 0

    const rows = this.db.prepare<Record<string, unknown>, Record<string, unknown>>(
      `SELECT * FROM qq_msg_history ${whereClause} ORDER BY timestamp DESC LIMIT @limit OFFSET @offset`,
    ).all({ ...bindings, limit, offset }) as Array<Record<string, unknown>>

    return rows.map(row => ({
      id: row.id as number,
      msgId: row.msg_id as string | undefined,
      type: row.type as 'group' | 'private',
      groupId: row.group_id as string | undefined,
      userId: row.user_id as string,
      userName: row.user_name as string,
      content: row.content as string,
      direction: row.direction as 'incoming' | 'outgoing',
      timestamp: row.timestamp as number,
    }))
  }

  /** 清理过期消息（保留最近 N 条） */
  cleanOldMsgs(keepCount: number = 1000): void {
    this.db.exec(`
      DELETE FROM qq_msg_history WHERE id NOT IN (
        SELECT id FROM qq_msg_history ORDER BY timestamp DESC LIMIT ${keepCount}
      )
    `)
  }
}