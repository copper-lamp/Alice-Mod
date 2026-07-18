/**
 * AgentFileExporter — 智能体配置文件导出器
 *
 * 将智能体配置从 SQLite 导出为 JSON 文件到模组目录（Alice/agents/）。
 * 使得 JE 侧（adapter-java）可以读取这些文件并创建对应的假人实例。
 *
 * 目录结构：
 *   <AliceDir>/agents/
 *     ├── agent-xxxx.json
 *     └── agent-yyyy.json
 *
 * Alice 目录路径通过已注册的实例文件路径（mcagent_instance.json）确定。
 */

import fs from 'node:fs'
import path from 'node:path'
import type { AgentConfig } from '../../renderer/src/lib/types'
import { getInstanceManager } from '../ipc/workspace-handler'

/** 导出文件 schema 版本 */
const SCHEMA_VERSION = '1.0'

/** 智能体配置文件目录名 */
const AGENTS_DIR = 'agents'

/**
 * 序列化后的智能体配置文件格式（写入 JSON 文件）
 */
export interface ExportedAgentConfig {
  schema_version: string
  agent_id: string
  name: string
  alias: string | null
  skin_data: string | null
  persona: {
    identity: string
    expertise: string[]
    personality: string[]
    workflow_id: string
    behavior_rules: {
      core: string[]
      strategy: Array<{ name: string; description: string; priority: number }>
      constraints: Array<{ name: string; description: string; consequence: string }>
    } | null
  }
  persona_preset_id: string | null
  tools: {
    enabled_tools: Record<string, boolean>
  }
  qq_binding: {
    enabled: boolean
    account_id: string | null
    group_ids: string[] | null
  }
  llm_config: {
    main_model: { provider_id: string; model_id: string; model_name: string }
    qq_bot_model: { same_as_main: boolean; provider_id?: string; model_id?: string; model_name?: string }
    compression_model: { same_as_main: boolean; provider_id?: string; model_id?: string; model_name?: string }
  }
  is_main: boolean
  workspace_id: string | null
  enabled: boolean
  created_at: number
  updated_at: number
}

export class AgentFileExporter {
  /**
   * 写入智能体配置文件到 Alice/agents/<agentId>.json
   */
  static async export(config: AgentConfig): Promise<void> {
    const agentsDir = this.ensureAgentsDir()
    if (!agentsDir) {
      // 无法确定 agents 目录，跳过导出（不报错）
      return
    }

    const filePath = path.join(agentsDir, `${config.id}.json`)
    const exported = this.toExportedConfig(config)
    fs.writeFileSync(filePath, JSON.stringify(exported, null, 2), 'utf-8')
  }

  /**
   * 删除 Alice/agents/<agentId>.json
   */
  static async remove(agentId: string): Promise<void> {
    const agentsDir = this.ensureAgentsDir()
    if (!agentsDir) return

    const filePath = path.join(agentsDir, `${agentId}.json`)
    try {
      fs.unlinkSync(filePath)
    } catch {
      // 文件不存在，忽略
    }
  }

  /**
   * V24: 确保 Alice/agents/ 目录存在，并返回目录路径
   *
   * 优先使用已注册实例的 file_path 确定 Alice 目录；
   * 若未连接任何实例，使用 CWD/Alice/ 作为兜底目录。
   * 无论哪种方式，始终创建 agents 子目录。
   */
  static ensureAgentsDir(): string | null {
    // 1. 尝试通过已注册实例确定 Alice 目录
    const aliceDir = this.resolveAliceDir()
    if (aliceDir) {
      const agentsDir = path.join(aliceDir, AGENTS_DIR)
      fs.mkdirSync(agentsDir, { recursive: true })
      return agentsDir
    }

    // 2. 兜底：使用 CWD/Alice/ 作为 Alice 目录
    const defaultDir = path.join(process.cwd(), 'Alice')
    try {
      fs.mkdirSync(defaultDir, { recursive: true })
      const agentsDir = path.join(defaultDir, AGENTS_DIR)
      fs.mkdirSync(agentsDir, { recursive: true })
      return agentsDir
    } catch {
      console.warn('[AgentFileExporter] 无法创建默认 agents 目录:', defaultDir)
      return null
    }
  }

  /**
   * 获取 Alice 目录路径
   * 从 InstanceManager 中查找已注册实例的 file_path，
   * 取其父目录作为 Alice 目录
   */
  private static resolveAliceDir(): string | null {
    try {
      const manager = getInstanceManager()
      const instances = manager.getAll()
      if (instances.length === 0) return null

      // 取第一个有 file_path 的实例
      for (const inst of instances) {
        if (inst.file_path) {
          const aliceDir = path.dirname(inst.file_path)
          if (fs.existsSync(aliceDir)) {
            return aliceDir
          }
        }
      }
      return null
    } catch {
      return null
    }
  }

  /**
   * 将 AgentConfig 转换为导出格式
   */
  private static toExportedConfig(config: AgentConfig): ExportedAgentConfig {
    return {
      schema_version: SCHEMA_VERSION,
      agent_id: config.id!,
      name: config.name,
      alias: config.alias ?? null,
      skin_data: config.skinData ?? null,
      persona: {
        identity: config.persona.identity,
        expertise: config.persona.expertise,
        personality: config.persona.personality,
        workflow_id: config.persona.workflowId,
        behavior_rules: config.persona.behaviorRules
          ? {
              core: config.persona.behaviorRules.core,
              strategy: config.persona.behaviorRules.strategy.map(s => ({
                name: s.name,
                description: s.description,
                priority: s.priority,
              })),
              constraints: config.persona.behaviorRules.constraints.map(c => ({
                name: c.name,
                description: c.description,
                consequence: c.consequence,
              })),
            }
          : null,
      },
      persona_preset_id: config.personaPresetId ?? null,
      tools: {
        enabled_tools: config.tools.enabledTools,
      },
      qq_binding: {
        enabled: config.qqBinding.enabled,
        account_id: config.qqBinding.accountId ?? null,
        group_ids: config.qqBinding.groupIds ?? null,
      },
      llm_config: {
        main_model: {
          provider_id: config.llmConfig.mainModel.providerId,
          model_id: config.llmConfig.mainModel.modelId,
          model_name: config.llmConfig.mainModel.modelName,
        },
        qq_bot_model: {
          same_as_main: config.llmConfig.qqBotModel.sameAsMain ?? false,
          provider_id: config.llmConfig.qqBotModel.providerId,
          model_id: config.llmConfig.qqBotModel.modelId,
          model_name: config.llmConfig.qqBotModel.modelName,
        },
        compression_model: {
          same_as_main: config.llmConfig.compressionModel.sameAsMain ?? false,
          provider_id: config.llmConfig.compressionModel.providerId,
          model_id: config.llmConfig.compressionModel.modelId,
          model_name: config.llmConfig.compressionModel.modelName,
        },
      },
      is_main: config.isMain ?? false,
      workspace_id: config.workspaceId ?? null,
      enabled: config.enabled !== false,
      created_at: config.createdAt ?? Date.now(),
      updated_at: config.updatedAt ?? Date.now(),
    }
  }
}