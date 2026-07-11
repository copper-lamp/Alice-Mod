/**
 * InstanceStore — 实例配置持久化存储
 *
 * 支持 instances 表的 CRUD，用于替代原有 JSON 文件存储。
 * 使用 DatabaseManager 的统一数据库连接。
 */

import type Database from 'better-sqlite3'
import { getDatabaseManager } from '../database'
import type { InstanceConfig } from './instance-validator'

// ════════════════════════════════════════════════════════════════
// 数据库行类型
// ════════════════════════════════════════════════════════════════

interface InstanceRow {
  instance_id: string
  name: string
  edition: string
  host: string
  tcp_port: number
  auth_token: string | null
  description: string | null
  tags: string
  created_at: number
  updated_at: number
}

// ════════════════════════════════════════════════════════════════
// 转换函数
// ════════════════════════════════════════════════════════════════

function rowToInstanceConfig(row: InstanceRow): InstanceConfig {
  return {
    instance_id: row.instance_id,
    name: row.name,
    edition: row.edition as 'bedrock' | 'java',
    host: row.host,
    port: row.tcp_port,
    auth_token: row.auth_token ?? '',
    description: row.description ?? undefined,
    tags: JSON.parse(row.tags) as string[],
  }
}

function instanceConfigToRow(config: InstanceConfig): InstanceRow {
  return {
    instance_id: config.instance_id,
    name: config.name,
    edition: config.edition,
    host: config.host,
    tcp_port: config.port,
    auth_token: config.auth_token || null,
    description: config.description ?? null,
    tags: JSON.stringify(config.tags ?? []),
    created_at: Date.now(),
    updated_at: Date.now(),
  }
}

// ════════════════════════════════════════════════════════════════
// InstanceStore
// ════════════════════════════════════════════════════════════════

export class InstanceStore {
  private get db(): Database.Database {
    return getDatabaseManager().getDb()
  }

  /** 获取所有实例配置 */
  getAll(): InstanceConfig[] {
    const rows = this.db.prepare<unknown[], InstanceRow>(
      'SELECT * FROM instances ORDER BY name ASC',
    ).all()
    return rows.map(rowToInstanceConfig)
  }

  /** 按 instance_id 获取实例 */
  get(instanceId: string): InstanceConfig | undefined {
    const row = this.db.prepare<unknown[], InstanceRow | undefined>(
      'SELECT * FROM instances WHERE instance_id = ?',
    ).get(instanceId) as InstanceRow | undefined
    return row ? rowToInstanceConfig(row) : undefined
  }

  /** 添加实例 */
  add(config: InstanceConfig): boolean {
    const existing = this.get(config.instance_id)
    if (existing) return false

    const row = instanceConfigToRow(config)
    this.db.prepare(`
      INSERT INTO instances (instance_id, name, edition, host, tcp_port, auth_token, description, tags, created_at, updated_at)
      VALUES (@instance_id, @name, @edition, @host, @tcp_port, @auth_token, @description, @tags, @created_at, @updated_at)
    `).run(row)
    return true
  }

  /** 更新实例 */
  update(instanceId: string, updates: Partial<InstanceConfig>): boolean {
    const existing = this.get(instanceId)
    if (!existing) return false

    const merged = { ...existing, ...updates, instance_id: instanceId }
    const row = instanceConfigToRow(merged)
    this.db.prepare(`
      INSERT OR REPLACE INTO instances (instance_id, name, edition, host, tcp_port, auth_token, description, tags, created_at, updated_at)
      VALUES (@instance_id, @name, @edition, @host, @tcp_port, @auth_token, @description, @tags, @created_at, @updated_at)
    `).run(row)
    return true
  }

  /** 删除实例 */
  remove(instanceId: string): boolean {
    const result = this.db.prepare('DELETE FROM instances WHERE instance_id = ?').run(instanceId)
    return result.changes > 0
  }

  /** 实例数量 */
  get count(): number {
    const row = this.db.prepare<unknown[], { count: number }>(
      'SELECT COUNT(*) as count FROM instances',
    ).get()!
    return row.count
  }

  /** 导入批量实例（去重） */
  importBatch(configs: InstanceConfig[]): { imported: number; skipped: number } {
    let imported = 0
    let skipped = 0

    const insert = this.db.prepare(`
      INSERT OR IGNORE INTO instances (instance_id, name, edition, host, tcp_port, auth_token, description, tags, created_at, updated_at)
      VALUES (@instance_id, @name, @edition, @host, @tcp_port, @auth_token, @description, @tags, @created_at, @updated_at)
    `)

    const update = this.db.prepare(`
      UPDATE instances SET name = @name, edition = @edition, host = @host, tcp_port = @tcp_port,
        auth_token = @auth_token, description = @description, tags = @tags, updated_at = @updated_at
      WHERE instance_id = @instance_id
    `)

    const tx = this.db.transaction(() => {
      for (const config of configs) {
        const existing = this.get(config.instance_id)
        if (existing) {
          const row = instanceConfigToRow(config)
          update.run(row)
          skipped++
        } else {
          const row = instanceConfigToRow(config)
          insert.run(row)
          imported++
        }
      }
    })
    tx()

    return { imported, skipped }
  }
}