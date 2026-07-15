import { randomUUID } from 'crypto'
import { getDatabaseManager } from '../database'
import type { AgentConfig, AgentSummary } from '../../renderer/src/lib/types'

export class AgentConfigManager {
  private cache: Map<string, AgentConfig> = new Map()
  private loaded = false

  async create(config: AgentConfig): Promise<string> {
    await this.ensureLoaded()
    const id = `agent-${randomUUID().slice(0, 8)}`
    const now = Date.now()
    const record: AgentConfig = { ...config, id, createdAt: now, updatedAt: now }
    this.cache.set(id, record)
    this.saveToDb(id, record)
    return id
  }

  async update(id: string, config: Partial<AgentConfig>): Promise<boolean> {
    await this.ensureLoaded()
    const existing = this.cache.get(id)
    if (!existing) return false
    const updated = { ...existing, ...config, updatedAt: Date.now() }
    this.cache.set(id, updated)
    this.saveToDb(id, updated)
    return true
  }

  async delete(id: string): Promise<boolean> {
    await this.ensureLoaded()
    const existed = this.cache.delete(id)
    if (existed) {
      try {
        const db = getDatabaseManager().getDb()
        db.run('DELETE FROM agents WHERE id = ?', [id])
      } catch { /* 忽略 */ }
    }
    return existed
  }

  async list(): Promise<AgentSummary[]> {
    await this.ensureLoaded()
    return Array.from(this.cache.values()).map(c => ({
      id: c.id!,
      name: c.alias || c.name,
      status: 'offline' as const,
      toolCount: Object.values(c.tools.enabledTools).filter(Boolean).length,
      lastActiveAt: c.updatedAt,
      skinData: c.skinData,
    }))
  }

  async get(id: string): Promise<AgentConfig | undefined> {
    await this.ensureLoaded()
    return this.cache.get(id)
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return
    this.loaded = true
    try {
      const db = getDatabaseManager().getDb()
      const rows = db.prepare('SELECT * FROM agents').all() as Array<{
        id: string; name: string; alias: string | null; skin_data: string | null
        persona_json: string; tools_json: string; qq_binding_json: string
        llm_config_json: string; created_at: number; updated_at: number
      }>
      for (const row of rows) {
        this.cache.set(row.id, {
          id: row.id,
          name: row.name,
          alias: row.alias ?? undefined,
          skinData: row.skin_data ?? undefined,
          persona: JSON.parse(row.persona_json),
          tools: JSON.parse(row.tools_json),
          qqBinding: JSON.parse(row.qq_binding_json),
          llmConfig: JSON.parse(row.llm_config_json),
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        })
      }
    } catch (err) {
      console.warn('[AgentConfigManager] 加载失败（数据库可能尚未初始化）:', err)
    }
  }

  private saveToDb(id: string, config: AgentConfig): void {
    try {
      const db = getDatabaseManager().getDb()
      db.prepare(
        `INSERT OR REPLACE INTO agents (id, name, alias, skin_data, persona_json, tools_json, qq_binding_json, llm_config_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id, config.name, config.alias ?? null, config.skinData ?? null,
        JSON.stringify(config.persona), JSON.stringify(config.tools),
        JSON.stringify(config.qqBinding), JSON.stringify(config.llmConfig),
        config.createdAt ?? Date.now(), config.updatedAt ?? Date.now(),
      )
    } catch (err) {
      console.error('[AgentConfigManager] 保存到 SQLite 失败:', err)
    }
  }
}
