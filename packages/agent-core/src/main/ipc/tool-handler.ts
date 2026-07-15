import { ipcMain } from 'electron'
import { getWorkspaceManager } from '../workspace'
import { getDatabaseManager } from '../database'
import type { ToolInfo } from '../../renderer/src/lib/types'
import type { ToolSchema } from '@mcagent/shared'

// ════════════════════════════════════════════════════
// 本地化映射
// ════════════════════════════════════════════════════

/** 工具中文名映射 */
const TOOL_LOCALE_MAP: Record<string, { displayName: string; categoryLabel: string }> = {
  // 感知类
  scan_surroundings: { displayName: '视野扫描', categoryLabel: '感知' },
  block_identifier: { displayName: '方块识别', categoryLabel: '感知' },
  entity_detection: { displayName: '实体检测', categoryLabel: '感知' },
  light_detection: { displayName: '光照检测', categoryLabel: '感知' },
  sound_detection: { displayName: '声音检测', categoryLabel: '感知' },
  environment_analysis: { displayName: '环境分析', categoryLabel: '感知' },
  // 移动类
  path_planning: { displayName: '路径规划', categoryLabel: '移动' },
  auto_navigate: { displayName: '自动寻路', categoryLabel: '移动' },
  jump: { displayName: '跳跃', categoryLabel: '移动' },
  fly: { displayName: '飞行', categoryLabel: '移动' },
  // 生存类
  auto_mine: { displayName: '自动采集', categoryLabel: '生存' },
  farm: { displayName: '耕种', categoryLabel: '生存' },
  fish: { displayName: '钓鱼', categoryLabel: '生存' },
  craft: { displayName: '合成', categoryLabel: '生存' },
  smelt: { displayName: '熔炼', categoryLabel: '生存' },
  // 对话类
  chat: { displayName: '聊天', categoryLabel: '对话' },
  command_response: { displayName: '指令响应', categoryLabel: '对话' },
  sentiment_analysis: { displayName: '情感分析', categoryLabel: '对话' },
  // 背包类
  inventory_manage: { displayName: '物品管理', categoryLabel: '背包' },
  equipment_manage: { displayName: '装备管理', categoryLabel: '背包' },
  container_operation: { displayName: '容器操作', categoryLabel: '背包' },
  item_sort: { displayName: '物品分类', categoryLabel: '背包' },
  // QQ 类
  qq_send: { displayName: '消息发送', categoryLabel: 'QQ' },
  qq_group_manage: { displayName: '群管理', categoryLabel: 'QQ' },
  qq_file_transfer: { displayName: '文件传输', categoryLabel: 'QQ' },
  qq_notify: { displayName: '通知', categoryLabel: 'QQ' },
  // 方块类
  mine_block: { displayName: '挖掘方块', categoryLabel: '方块' },
  place_block: { displayName: '放置方块', categoryLabel: '方块' },
  use_block: { displayName: '使用方块', categoryLabel: '方块' },
  area_operation: { displayName: '区域操作', categoryLabel: '方块' },
  // 实体类
  interact_entity: { displayName: '交互实体', categoryLabel: '实体' },
  lead_entity: { displayName: '牵引实体', categoryLabel: '实体' },
  // 战斗类
  set_combat_mode: { displayName: '设置战斗模式', categoryLabel: '战斗' },
  stop_combat: { displayName: '停止战斗', categoryLabel: '战斗' },
}

/** 分类中文映射 */
const CATEGORY_LABEL_MAP: Record<string, string> = {
  perception: '感知类',
  movement: '移动类',
  survival: '生存类',
  dialogue: '对话类',
  inventory: '背包类',
  qq: 'QQ 类',
  block: '方块类',
  entity: '实体类',
  combat: '战斗类',
  chat: '对话类',
  memory: '记忆类',
  task: '任务类',
  other: '其他',
}

// ════════════════════════════════════════════════════
// 工具函数
// ════════════════════════════════════════════════════

/**
 * 将 ToolSchema 数组展平并合并中文映射
 */
function flattenTools(allTools: Map<string, ToolSchema[]>): ToolInfo[] {
  const seen = new Set<string>()
  const result: ToolInfo[] = []

  for (const tools of allTools.values()) {
    for (const tool of tools) {
      if (seen.has(tool.name)) continue
      seen.add(tool.name)

      const locale = TOOL_LOCALE_MAP[tool.name] ?? {
        displayName: tool.name,
        categoryLabel: tool.category ?? '其他',
      }

      const category = tool.category ?? 'other'
      const categoryLabel = CATEGORY_LABEL_MAP[category] ?? locale.categoryLabel

      result.push({
        name: tool.name,
        displayName: locale.displayName,
        description: tool.description ?? '',
        category,
        categoryLabel,
        parameters: Object.entries(tool.parameters ?? {}).map(([name, param]) => ({
          name,
          type: (param as any).type ?? 'string',
          description: (param as any).description ?? '',
          required: (param as any).required ?? false,
          defaultValue: (param as any).default,
        })),
      })
    }
  }

  return result
}

/**
 * 从 SQLite 恢复工具列表到内存 ToolRegistry
 */
function restoreFromDb(): ToolSchema[] {
  try {
    const db = getDatabaseManager().getDb()
    const rows = db.prepare('SELECT * FROM tool_registry ORDER BY updated_at DESC').all() as Array<{
      workspace_id: string
      tool_hash: string
      tool_json: string
    }>

    if (rows.length === 0) return []

    const allSchemas: ToolSchema[] = []
    const wm = getWorkspaceManager()
    const toolRegistry = wm.getToolRegistry()

    for (const row of rows) {
      const tools = JSON.parse(row.tool_json) as ToolSchema[]
      allSchemas.push(...tools)
      // 恢复 hash 到内存（不触发写入）
      ;(toolRegistry as any).hashes?.set(row.workspace_id, row.tool_hash)
      ;(toolRegistry as any).registry?.set(row.workspace_id, tools)
    }

    return allSchemas
  } catch {
    return []
  }
}

// ════════════════════════════════════════════════════
// IPC Handler
// ════════════════════════════════════════════════════

export function registerToolHandlers(): void {
  ipcMain.handle('tool:list-all', async () => {
    const wm = getWorkspaceManager()
    const toolRegistry = wm.getToolRegistry()
    const allTools = toolRegistry.getAll()

    // 分级查询: 1. 内存
    if (allTools.size > 0) {
      return flattenTools(allTools)
    }

    // 分级查询: 2. SQLite（内存无数据时）
    const schemas = restoreFromDb()
    if (schemas.length > 0) {
      // 重建 memory Map 并返回
      const restored = new Map<string, ToolSchema[]>()
      restored.set('restored', schemas)
      return flattenTools(restored)
    }

    return [] as ToolInfo[]
  })
}
