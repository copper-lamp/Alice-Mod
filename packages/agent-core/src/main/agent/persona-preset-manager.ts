import { randomUUID } from 'crypto'
import { getDatabaseManager } from '../database'
import { listIdentityTemplates } from '../prompt/agent/identity-templates'
import type { PersonaPreset } from '../../renderer/src/lib/types'

export class PersonaPresetManager {
  private builtinPresets: Map<string, PersonaPreset> = new Map()
  private customPresets: Map<string, PersonaPreset> = new Map()
  private customLoaded = false

  constructor() {
    this.loadBuiltinPresets()
  }

  private loadBuiltinPresets(): void {
    const templates = listIdentityTemplates()
    for (const template of templates) {
      this.builtinPresets.set(template.id, {
        id: template.id,
        name: template.name,
        description: template.description,
        identity: template.identity,
        expertise: template.recommendedToolCategories,
        personality: template.personality,
        workflowId: template.recommendedWorkflow ?? 'explore_gather',
        behaviorRules: {
          core: template.rules.core,
          strategy: template.rules.strategy.map(s => ({ name: s.name, description: s.description, priority: s.priority })),
          constraints: template.rules.constraints.map(c => ({ name: c.name, description: c.description, consequence: c.consequence })),
        },
        recommendedToolCategories: template.recommendedToolCategories,
        isBuiltin: true,
      })
    }
  }

  private async ensureCustomLoaded(): Promise<void> {
    if (this.customLoaded) return
    this.customLoaded = true
    try {
      const db = getDatabaseManager().getDb()
      const rows = db.prepare('SELECT * FROM persona_presets WHERE is_builtin = 0').all() as Array<{
        id: string; name: string; description: string | null; identity: string
        expertise_json: string; personality_json: string; workflow_id: string
        behavior_rules_json: string | null; recommended_tool_categories_json: string | null
        created_at: number
      }>
      for (const row of rows) {
        this.customPresets.set(row.id, {
          id: row.id,
          name: row.name,
          description: row.description ?? '',
          identity: row.identity,
          expertise: JSON.parse(row.expertise_json),
          personality: JSON.parse(row.personality_json),
          workflowId: row.workflow_id,
          behaviorRules: row.behavior_rules_json ? JSON.parse(row.behavior_rules_json) : { core: [], strategy: [], constraints: [] },
          recommendedToolCategories: row.recommended_tool_categories_json ? JSON.parse(row.recommended_tool_categories_json) : [],
          isBuiltin: false,
          createdAt: row.created_at,
        })
      }
    } catch (err) {
      console.warn('[PersonaPresetManager] 加载自定义预设失败（数据库可能尚未初始化）:', err)
    }
  }

  async list(): Promise<PersonaPreset[]> {
    await this.ensureCustomLoaded()
    return [...this.builtinPresets.values(), ...this.customPresets.values()]
  }

  async get(id: string): Promise<PersonaPreset | undefined> {
    await this.ensureCustomLoaded()
    return this.builtinPresets.get(id) ?? this.customPresets.get(id)
  }

  async create(preset: Omit<PersonaPreset, 'id' | 'isBuiltin' | 'createdAt'>): Promise<string> {
    await this.ensureCustomLoaded()
    const id = `custom-${randomUUID().slice(0, 8)}`
    const now = Date.now()
    const record: PersonaPreset = {
      ...preset,
      id,
      isBuiltin: false,
      createdAt: now,
    }
    this.customPresets.set(id, record)
    this.saveToDb(record)
    return id
  }

  async update(id: string, preset: Partial<PersonaPreset>): Promise<boolean> {
    await this.ensureCustomLoaded()
    const existing = this.customPresets.get(id)
    if (!existing) return false
    const updated = { ...existing, ...preset }
    this.customPresets.set(id, updated)
    this.saveToDb(updated)
    return true
  }

  async delete(id: string): Promise<boolean> {
    await this.ensureCustomLoaded()
    if (this.builtinPresets.has(id)) return false
    const existed = this.customPresets.delete(id)
    if (existed) {
      try {
        const db = getDatabaseManager().getDb()
        db.prepare('DELETE FROM persona_presets WHERE id = ?').run(id)
      } catch { /* 忽略 */ }
    }
    return existed
  }

  private saveToDb(preset: PersonaPreset): void {
    if (preset.isBuiltin) return
    try {
      const db = getDatabaseManager().getDb()
      db.prepare(
        `INSERT OR REPLACE INTO persona_presets (id, name, description, identity, expertise_json, personality_json, workflow_id, behavior_rules_json, recommended_tool_categories_json, is_builtin, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`
      ).run(
        preset.id,
        preset.name,
        preset.description,
        preset.identity,
        JSON.stringify(preset.expertise),
        JSON.stringify(preset.personality),
        preset.workflowId,
        JSON.stringify(preset.behaviorRules),
        JSON.stringify(preset.recommendedToolCategories),
        preset.createdAt ?? Date.now(),
      )
    } catch (err) {
      console.error('[PersonaPresetManager] 保存到 SQLite 失败:', err)
    }
  }
}
