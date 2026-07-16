/**
 * 工具 Schema 归一化（协议兼容层）
 *
 * 将 access core 发送的原始工具 entry 归一化为 AC 端 ToolSchema。
 * 兼容 JE 端（SchemaGenerator）和 BE 端（ToolRegistry）两种来源格式。
 *
 * 独立模块，避免引入 electron 或其他模块级副作用。
 */

import type { ToolSchema } from '@mcagent/shared'

/**
 * 已知分类白名单。JE 端 SchemaGenerator.inferCategory 暂返回 ""，
 * 所以从参数名/工具名前缀推断分类。
 */
const KNOWN_CATEGORIES = new Set([
  'perception', 'movement', 'inventory', 'entity', 'survival',
  'block', 'chat', 'qq', 'memory', 'task',
])

/** 工具名前缀 → 分类推断表 */
const CATEGORY_PREFIX_HINTS: Array<[string, string]> = [
  ['look_', 'perception'],
  ['scan_', 'perception'],
  ['inspect_', 'perception'],
  ['move_', 'movement'],
  ['path_', 'movement'],
  ['navigate_', 'movement'],
  ['bot_', 'entity'],
  ['spawn_', 'entity'],
  ['inv_', 'inventory'],
  ['organize_', 'inventory'],
  ['equip_', 'inventory'],
  ['craft_', 'survival'],
  ['eat_', 'survival'],
  ['mine_', 'block'],
  ['place_', 'block'],
  ['fill_', 'block'],
  ['chat_', 'chat'],
  ['say_', 'chat'],
  ['task_', 'task'],
  ['plan_', 'task'],
  ['memory_', 'memory'],
  ['recall_', 'memory'],
]

/**
 * 将 access core 发送的原始工具 entry 归一化为 AC 端 ToolSchema。
 *
 * 兼容两种来源格式：
 * - JE 端（SchemaGenerator）：{name, description, category, input_schema, output_schema, execution}
 * - BE 端（ToolRegistry）：{name, description, category, parameters, enabled}
 *
 * 输出统一为 ToolSchema：{name, description, parameters, category, enabled}。
 */
export function normalizeToolSchema(raw: Record<string, unknown>): ToolSchema {
  // 1. name
  const name = typeof raw.name === 'string' ? raw.name : 'unknown_tool'

  // 2. description
  const description = typeof raw.description === 'string' ? raw.description : ''

  // 3. parameters: 兼容 input_schema (JSON Schema 风格) / parameters (字典风格) / function.parameters (BE)
  let parameters: ToolSchema['parameters'] = {}
  const inputSchema = (raw as any).input_schema
  const directParams = (raw as any).parameters
  const functionParams = ((raw as any).function as any)?.parameters
  if (inputSchema && typeof inputSchema === 'object') {
    parameters = jsonSchemaToParams(inputSchema as Record<string, unknown>)
  } else if (directParams && typeof directParams === 'object') {
    parameters = directParams as ToolSchema['parameters']
  } else if (functionParams && typeof functionParams === 'object') {
    parameters = jsonSchemaToParams(functionParams as Record<string, unknown>)
  }

  // 4. category: 优先用已声明值，缺失则按工具名前缀推断
  let category: ToolSchema['category'] = 'task' as any
  const declaredCategory = raw.category
  if (typeof declaredCategory === 'string' && KNOWN_CATEGORIES.has(declaredCategory)) {
    category = declaredCategory as ToolSchema['category']
  } else {
    const inferred = CATEGORY_PREFIX_HINTS.find(([prefix]) => name.startsWith(prefix))
    category = (inferred ? inferred[1] : 'task') as ToolSchema['category']
  }

  // 5. enabled: 默认 true
  const enabled = (raw as any).enabled !== false

  return { name, description, parameters, category, enabled }
}

/**
 * 将 JSON Schema 风格的 `{type: "object", properties: {...}, required: [...]}`
 * 转换为 AC 端 `Record<string, ParamDefinition>`。
 * 支持嵌套 object / array。
 */
export function jsonSchemaToParams(schema: Record<string, unknown>): ToolSchema['parameters'] {
  const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>
  const required = new Set(Array.isArray(schema.required) ? (schema.required as string[]) : [])
  const result: ToolSchema['parameters'] = {}
  for (const [key, def] of Object.entries(properties)) {
    const t = (def.type as ToolSchema['parameters'][string]['type']) ?? 'string'
    const propDef = def.properties
    const itemDef = def.items
    result[key] = {
      type: t,
      description: typeof def.description === 'string' ? def.description : '',
      required: required.has(key),
      ...(Array.isArray(def.enum) ? { enum: def.enum as string[] } : {}),
      ...(def.default !== undefined ? { default: def.default } : {}),
      ...(propDef ? { properties: jsonSchemaToParams(propDef as Record<string, unknown>) } : {}),
      ...(itemDef ? { items: convertSingleParam(itemDef as Record<string, unknown>) } : {}),
    }
  }
  return result
}

/** JSON Schema 中单个参数定义 → ParamDefinition（用于 items 嵌套） */
export function convertSingleParam(def: Record<string, unknown>): ToolSchema['parameters'][string] {
  return {
    type: (def.type as ToolSchema['parameters'][string]['type']) ?? 'string',
    description: typeof def.description === 'string' ? def.description : '',
    required: def.required === true,
    ...(Array.isArray(def.enum) ? { enum: def.enum as string[] } : {}),
    ...(def.default !== undefined ? { default: def.default } : {}),
  }
}