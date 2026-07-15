import { ipcMain } from 'electron'
import { getWorkspaceManager } from '../workspace'
import { PromptBuilder, DefaultToolPromptAssembler, DefaultSystemPromptBuilder, DefaultStateInjector, DefaultContextWindowManager, DefaultCacheKeyBuilder, DefaultPromptTemplateEngine } from '../prompt'
import type { AgentProfile, BuildParams, ConversationMessage, ToolPromptDefinition } from '../prompt/types'
import { DEFAULT_AGENT_PROFILE } from '../prompt/types'
import { getWorkflowTemplate } from '../prompt/agent/workflow-templates'

/**
 * 构建真实 LLM 提示词，输出到控制台
 */
async function buildRealPrompt(params: {
  name: string
  identity: string
  expertise: string[]
  personality: string[]
  workflowId: string
  enabledTools: Record<string, boolean>
  behaviorRules?: { core: string[]; strategy: Array<{ name: string; description: string; priority: number }>; constraints: Array<{ name: string; description: string; consequence: string }> }
  communicationStyle?: string[]
  boundaries?: string[]
}): Promise<string> {
  const wm = getWorkspaceManager()
  const toolRegistry = wm.getToolRegistry()

  // 1. 根据 workflowId 生成工作流描述
  let workflowDescription: string | undefined
  const workflowTemplate = getWorkflowTemplate(params.workflowId)
  if (workflowTemplate) {
    workflowDescription = `遵循 ${workflowTemplate.name} 工作流：${workflowTemplate.description}`
  }

  // 2. 构建 AgentProfile
  const profile: AgentProfile = {
    ...DEFAULT_AGENT_PROFILE,
    name: params.name || 'TestAgent',
    identity: params.identity || DEFAULT_AGENT_PROFILE.identity,
    expertise: params.expertise.length > 0 ? params.expertise : undefined,
    personality: params.personality.length > 0 ? params.personality : DEFAULT_AGENT_PROFILE.personality,
    workflowDescription,
    communicationStyle: params.communicationStyle && params.communicationStyle.length > 0 ? params.communicationStyle : undefined,
    boundaries: params.boundaries && params.boundaries.length > 0 ? params.boundaries : undefined,
    preferences: {
      ...DEFAULT_AGENT_PROFILE.preferences,
      verbosity: 2, // 详细模式，以便看到完整工具描述
    },
  }

  // 2b. 如果有 behaviorRules，覆盖默认 rules
  if (params.behaviorRules) {
    profile.rules = {
      core: params.behaviorRules.core ?? [],
      strategy: (params.behaviorRules.strategy ?? []).map(s => ({ name: s.name, description: s.description, priority: s.priority })),
      constraints: (params.behaviorRules.constraints ?? []).map(c => ({
        name: c.name,
        description: c.description,
        consequence: c.consequence as 'warning' | 'block' | 'replan',
      })),
    }
  }

  // 3. 创建 PromptBuilder
  const builder = new PromptBuilder({
    profile,
    toolRegistry: {
      getTools: (wsId: string) => toolRegistry.getTools(wsId),
    },
    assembler: new DefaultToolPromptAssembler({
      getTools: (wsId: string) => toolRegistry.getTools(wsId),
    }),
    systemPromptBuilder: new DefaultSystemPromptBuilder(new DefaultPromptTemplateEngine()),
    stateInjector: new DefaultStateInjector(),
    contextManager: new DefaultContextWindowManager(),
    cacheKeyBuilder: new DefaultCacheKeyBuilder(),
  })

  // 4. 获取第一个在线工作区（如果没有，尝试获取任意工作区）
  const workspaces = wm.getAllWorkspaces()
  const workspace = wm.getOnlineWorkspaces()[0] ?? workspaces[0]
  const workspaceId = workspace?.id ?? '__debug__'

  // 5. 计算禁用工具列表
  const disabledTools = Object.entries(params.enabledTools)
    .filter(([_, v]) => !v)
    .map(([name]) => name)

  // 6. 构建真实提示词
  const buildParams: BuildParams = {
    workspaceId,
    userInput: '请描述你当前的状态和周围环境。',
    history: [] as ConversationMessage[],
    state: {
      health: 20,
      hunger: 20,
      saturation: 5,
      position: { x: 0, y: 64, z: 0, dimension: 'overworld', biome: 'plains' },
      statusEffects: [],
    },
    source: 'user',
    extraContext: {
      providerId: 'openai',
      excludeTools: disabledTools.length > 0 ? disabledTools : undefined,
      expertise: params.expertise,
      workflowDescription,
      behaviorRules: params.behaviorRules,
      communicationStyle: params.communicationStyle,
      boundaries: params.boundaries,
    },
  }

  const result = await builder.build(buildParams)

  // 7. 格式化输出
  const lines: string[] = []
  const SEP = '═'.repeat(60)
  const DASH = '─'.repeat(60)

  // ── 头部信息 ──
  lines.push(SEP)
  lines.push(`  【LLM 提示词组装 · 真实输出】`)
  lines.push(`  智能体:         ${params.name}`)
  lines.push(`  工作区:         ${workspaceId} (${workspace?.state ?? 'offline'})`)
  lines.push(`  身份:           ${(params.identity || '(空)').slice(0, 80)}${(params.identity || '').length > 80 ? '...' : ''}`)
  lines.push(`  性格特征:       ${params.personality.length > 0 ? params.personality.join(', ') : '(无)'}`)
  lines.push(`  专业设定:       ${params.expertise.length > 0 ? params.expertise.join(', ') : '(无)'}`)
  lines.push(`  工作流:         ${params.workflowId}${workflowDescription ? ` → ${workflowDescription}` : ''}`)
  lines.push(`  沟通风格:       ${params.communicationStyle && params.communicationStyle.length > 0 ? params.communicationStyle.join(', ') : '(默认)'}`)
  lines.push(`  行为边界:       ${params.boundaries && params.boundaries.length > 0 ? params.boundaries.join(', ') : '(默认)'}`)
  lines.push(`  工具总数:       ${result.tools.length} 个 (禁用 ${disabledTools.length} 个)`)
  lines.push(`  禁用工具列表:   ${disabledTools.length > 0 ? disabledTools.join(', ') : '(无)'}`)
  lines.push(`  缓存命中:       ${result.cacheHit ? '是' : '否'}`)
  lines.push(SEP)
  lines.push('')

  // ── 消息内容 ──
  for (let i = 0; i < result.messages.length; i++) {
    const msg = result.messages[i]
    const roleLabel = msg.role === 'system' ? 'SYSTEM' : msg.role === 'user' ? 'USER' : 'ASSISTANT'
    lines.push(`┌── [${roleLabel}] 消息 ${i + 1}/${result.messages.length} (${msg.content.length} 字符)`)
    lines.push('│')
    const contentLines = msg.content.split('\n')
    for (const line of contentLines) {
      lines.push(`│ ${line}`)
    }
    lines.push('└──')
    lines.push('')
  }

  // ── 工具定义（Function Calling 格式） ──
  lines.push(SEP)
  lines.push(`  工具定义 (Tool Definitions) — 共 ${result.tools.length} 个`)
  lines.push(`  说明：以下为 LLM Function Calling 格式的工具定义，`)
  lines.push(`        与 messages 一起发送给 LLM`)
  lines.push(SEP)
  lines.push('')

  for (let i = 0; i < result.tools.length; i++) {
    const tool = result.tools[i]
    lines.push(`┌── [TOOL ${i + 1}/${result.tools.length}] ${tool.name}`)
    lines.push(`│   描述: ${tool.description}`)
    lines.push(`│   分类: ${tool.category}`)
    lines.push(`│   优先级: ${tool.priority}`)
    if (tool.examples && tool.examples.length > 0) {
      lines.push(`│   示例: ${tool.examples.length} 个`)
    }
    lines.push('│')
    
    // 参数
    const paramKeys = Object.keys(tool.parameters)
    if (paramKeys.length > 0) {
      lines.push(`│   参数 (${paramKeys.length} 个):`)
      for (const pName of paramKeys) {
        const p = tool.parameters[pName]
        lines.push(`│     ${pName}:`)
        lines.push(`│       type:        ${p.type}`)
        lines.push(`│       description: ${p.description}`)
        lines.push(`│       required:    ${p.required ?? false}`)
        if (p.enum) lines.push(`│       enum:        [${p.enum.join(', ')}]`)
        if (p.default !== undefined) lines.push(`│       default:     ${p.default}`)
      }
    } else {
      lines.push(`│   参数: 无`)
    }
    lines.push('└──')
    lines.push('')
  }

  // ── Token 统计 ──
  lines.push(SEP)
  lines.push('  Token 估算')
  lines.push(SEP)
  const tb = result.tokenBreakdown
  lines.push(`  系统提示词:    ${tb.systemPrompt}`)
  lines.push(`  状态注入:      ${tb.stateInjection}`)
  lines.push(`  工具定义:      ${tb.toolDefinitions}`)
  lines.push(`  对话历史:      ${tb.conversationHistory}`)
  lines.push(`  用户输入:      ${tb.userInput}`)
  lines.push(`  自定义片段:    ${tb.fragments}`)
  lines.push(`  ─────────────────────`)
  lines.push(`  总计:          ${tb.total}`)
  lines.push('')

  // ── 缓存信息 ──
  const cacheInfo = result.cache
  lines.push(SEP)
  lines.push('  缓存信息')
  lines.push(SEP)
  lines.push(`  Key:          ${cacheInfo.key}`)
  lines.push(`  静态 Tokens:  ${cacheInfo.staticTokens}`)
  lines.push(`  动态 Tokens:  ${cacheInfo.dynamicTokens}`)
  lines.push(`  总 Tokens:    ${cacheInfo.totalTokens}`)
  lines.push(`  Region 1(系统): ${cacheInfo.regions.system}`)
  lines.push(`  Region 2(工具): ${cacheInfo.regions.tools}`)
  lines.push(`  Region 3(动态): ${cacheInfo.regions.dynamic}`)
  lines.push(SEP)

  return lines.join('\n')
}

export function registerDebugHandlers(): void {
  ipcMain.handle('debug:assemble-prompt', async (_event, params: {
    name: string
    identity: string
    expertise: string[]
    personality: string[]
    workflowId: string
    enabledTools: Record<string, boolean>
    behaviorRules?: { core: string[]; strategy: Array<{ name: string; description: string; priority: number }>; constraints: Array<{ name: string; description: string; consequence: string }> }
    communicationStyle?: string[]
    boundaries?: string[]
  }) => {
    try {
      const prompt = await buildRealPrompt(params)
      console.log('\n' + prompt + '\n')
      return { success: true, prompt }
    } catch (err) {
      const errorMsg = `提示词组装失败: ${(err as Error).message}`
      console.error('[debug]', errorMsg, (err as Error).stack)
      return { success: false, prompt: errorMsg }
    }
  })
}