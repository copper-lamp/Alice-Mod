import { randomUUID } from 'crypto'
import { getDatabaseManager } from '../database'
import { AgentFileExporter } from './agent-file-exporter'
import { PromptCompiler } from '../prompt/compiler/prompt-compiler'
import type { AgentConfig, AgentSummary } from '../../renderer/src/lib/types'

export class AgentConfigManager {
  private cache: Map<string, AgentConfig> = new Map()
  private loaded = false

  async create(config: AgentConfig): Promise<string> {
    await this.ensureLoaded()
    const id = `agent-${randomUUID().slice(0, 8)}`

    // V26: 编译系统提示词
    const compiledPrompt = PromptCompiler.compile(config)
    // V28: 编译 QQ 系统提示词
    const qqCompiledPrompt = PromptCompiler.compileQQ(config)

    const now = Date.now()
    const record: AgentConfig = { ...config, id, compiledPrompt, enabled: config.enabled ?? true, createdAt: now, updatedAt: now }
    this.cache.set(id, record)
    this.saveToDb(id, record)

    // V21: 导出到模组目录
    AgentFileExporter.export(record).catch(err =>
      console.warn('[AgentConfigManager] 导出到文件失败:', err)
    )

    return id
  }

  async update(id: string, config: Partial<AgentConfig>): Promise<boolean> {
    await this.ensureLoaded()
    const existing = this.cache.get(id)
    if (!existing) return false
    const updated = { ...existing, ...config, updatedAt: Date.now() }

    // V26: 配置变更后重新编译系统提示词
    updated.compiledPrompt = PromptCompiler.compile(updated)
    // V28: 重新编译 QQ 系统提示词
    updated.qqCompiledPrompt = PromptCompiler.compileQQ(updated)

    this.cache.set(id, updated)
    this.saveToDb(id, updated)

    // V21: 更新后重新导出
    AgentFileExporter.export(updated).catch(err =>
      console.warn('[AgentConfigManager] 导出到文件失败:', err)
    )

    return true
  }

  async delete(id: string): Promise<boolean> {
    await this.ensureLoaded()
    const existed = this.cache.delete(id)
    if (existed) {
      try {
        const db = getDatabaseManager().getDb()
        db.prepare('DELETE FROM agents WHERE id = ?').run(id)
      } catch { /* 忽略 */ }

      // V21: 删除对应的配置文件
      AgentFileExporter.remove(id).catch(err =>
        console.warn('[AgentConfigManager] 删除配置文件失败:', err)
      )
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
      enabled: c.enabled ?? true,
      botOnline: false,
    }))
  }

  async get(id: string): Promise<AgentConfig | undefined> {
    await this.ensureLoaded()
    return this.cache.get(id)
  }

  /**
   * V20：列出指定 workspace 的所有 agent。
   * workspaceId 为空字符串时返回 workspaceId 未设置（兼容存量）的 agent。
   */
  async listByWorkspace(workspaceId: string): Promise<AgentConfig[]> {
    await this.ensureLoaded()
    return Array.from(this.cache.values()).filter(
      c => (c.workspaceId ?? '') === workspaceId,
    )
  }

  /**
   * V20：找出指定 workspace 内的 main agent（isMain=true）。
   * 若没有 main agent，返回 undefined（调用方可按 §4.8 自动标记第一个为 main）。
   */
  async getMainAgent(workspaceId: string): Promise<AgentConfig | undefined> {
    const list = await this.listByWorkspace(workspaceId)
    return list.find(c => c.isMain === true)
  }

  /**
   * V20：原子地把指定 agent 标记为 workspace 内的 main agent，
   * 同时把同 workspace 内其他 agent 的 isMain 置为 false。
   */
  async markMain(agentId: string): Promise<boolean> {
    await this.ensureLoaded()
    const target = this.cache.get(agentId)
    if (!target) return false
    const workspaceId = target.workspaceId ?? ''
    // 同 workspace 内其他 agent 取消 main 标记
    for (const [id, c] of this.cache) {
      if (id !== agentId && (c.workspaceId ?? '') === workspaceId && c.isMain) {
        await this.update(id, { isMain: false })
      }
    }
    // 标记目标为 main
    if (!target.isMain) {
      await this.update(agentId, { isMain: true })
    }
    return true
  }

  /**
   * V26：更新指定 agent 的预编译提示词（用于惰性编译回填）
   * V28：支持同时回填 qqCompiledPrompt
   */
  async updateCompiledPrompt(agentId: string, compiledPrompt: string | undefined, qqCompiledPrompt?: string): Promise<void> {
    const existing = this.cache.get(agentId)
    if (existing) {
      if (compiledPrompt !== undefined) existing.compiledPrompt = compiledPrompt
      if (qqCompiledPrompt !== undefined) existing.qqCompiledPrompt = qqCompiledPrompt
      this.saveToDb(agentId, existing)
    }
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return
    this.loaded = true
    try {
      const db = getDatabaseManager().getDb()
      const rows = db.prepare('SELECT * FROM agents').all() as Array<{
        id: string; name: string; alias: string | null; skin_data: string | null
        persona_json: string; tools_json: string; qq_binding_json: string
        llm_config_json: string; compiled_prompt: string | null; created_at: number; updated_at: number
        is_main: number | null; workspace_id: string | null
        qq_persona_json: string | null; qq_compiled_prompt: string | null
        enabled: number | null
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
          compiledPrompt: row.compiled_prompt ?? undefined,
          qqPersona: row.qq_persona_json ? JSON.parse(row.qq_persona_json) : undefined,
          qqCompiledPrompt: row.qq_compiled_prompt ?? undefined,
          isMain: row.is_main === 1,
          workspaceId: row.workspace_id ?? undefined,
          enabled: row.enabled !== 0,
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
      // V24: 提取 qq_binding_account_id 以支持索引加速查找
      const qqBindingAccountId = config.qqBinding?.enabled ? (config.qqBinding.accountId ?? null) : null
      db.prepare(
        `INSERT OR REPLACE INTO agents (id, name, alias, skin_data, persona_json, tools_json, qq_binding_json, qq_binding_account_id, llm_config_json, compiled_prompt, qq_persona_json, qq_compiled_prompt, is_main, workspace_id, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id, config.name, config.alias ?? null, config.skinData ?? null,
        JSON.stringify(config.persona), JSON.stringify(config.tools),
        JSON.stringify(config.qqBinding), qqBindingAccountId,
        JSON.stringify(config.llmConfig),
        config.compiledPrompt ?? null,
        config.qqPersona ? JSON.stringify(config.qqPersona) : null,
        config.qqCompiledPrompt ?? null,
        config.isMain ? 1 : 0, config.workspaceId ?? null,
        config.enabled !== false ? 1 : 0,
        config.createdAt ?? Date.now(), config.updatedAt ?? Date.now(),
      )
    } catch (err) {
      console.error('[AgentConfigManager] 保存到 SQLite 失败:', err)
    }
  }
}
