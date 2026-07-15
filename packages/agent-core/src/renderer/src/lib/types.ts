/** 对话消息 */
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  thinking?: string
  toolCalls?: ToolCallInfo[]
  timestamp: number
  workspaceId: string
  /** 消息来源：game=游戏内聊天, qq=QQ 消息, system=系统 */
  source?: 'game' | 'qq' | 'system'
}

/** 工具调用信息 */
export interface ToolCallInfo {
  id: string
  name: string
  category: string
  params: Record<string, unknown>
  result?: {
    success: boolean
    data?: unknown
    duration_ms?: number
  }
  status: 'pending' | 'running' | 'success' | 'error'
}

/** 流式输出 Chunk */
export interface StreamChunk {
  id: string
  content?: string
  thinking?: string
  toolCalls?: ToolCallInfo[]
  isLast: boolean
}

/** Provider 信息 */
export interface ProviderInfo {
  id: string
  name: string
  available: boolean
  latencyMs?: number
}

/** 模型信息 */
export interface ModelInfo {
  id: string
  name: string
  providerId: string
  supportsFunctionCalling: boolean
  contextWindow: number
}

/** 配置项 */
export interface ConfigEntry {
  key: string
  value: string
  valueType: 'string' | 'number' | 'boolean' | 'json'
  description?: string
}

/** 工作区信息 */
export interface WorkspaceInfo {
  id: string
  name: string
  status: 'offline' | 'connecting' | 'online'
  toolCount: number
  lastActiveAt?: number
}

/** TCP 状态 */
export interface TcpStatus {
  port: number
  connectionCount: number
  isListening: boolean
}

/** LLM 用量统计 */
export interface UsageStats {
  todayTokens: number
  monthTokens: number
  dailyUsage: { date: string; tokens: number }[]
}

// ==========================================
// V8 新增类型
// ==========================================

/** 布局模式 */
export type LayoutMode = 'nav-view' | 'agent-view' | 'agent-create'

/** 导航面板类型 */
export type NavPanelType = 'dashboard' | 'model' | 'knowledge' | 'robot'

/** 智能体实例 Tab */
export type AgentViewTab = 'info' | 'config'

/** 仪表盘统计数据 */
export interface DashboardStats {
  todayTokens: number
  monthTokens: number
  totalTokens: number
  activeConnections: number
  totalAgents: number
  onlineAgents: number
  providerDistribution: ProviderUsage[]
  topModels: ModelUsage[]
}

/** Provider 用量分布 */
export interface ProviderUsage {
  providerId: string
  providerName: string
  tokenCount: number
  percentage: number
  callCount: number
}

/** 模型用量排行 */
export interface ModelUsage {
  modelId: string
  modelName: string
  providerId: string
  tokenCount: number
  callCount: number
}

/** 每日用量 */
export interface DailyUsage {
  date: string
  tokens: number
  callCount: number
}

/** 智能体活跃时段数据 */
export interface ActivityData {
  workspaceId: string
  workspaceName: string
  hourlyActivity: number[]
  dailyActivity: number[]
}

/** 智能体概要（列表用） */
export interface AgentSummary {
  id: string
  name: string
  status: 'online' | 'offline' | 'connecting'
  toolCount: number
  lastActiveAt?: number
  workspaceId?: string
  skinData?: string
}

/** 智能体完整配置 */
export interface AgentConfig {
  id?: string
  name: string
  alias?: string
  skinData?: string
  persona: AgentPersona
  personaPresetId?: string
  tools: AgentToolConfig
  qqBinding: QQBinding
  llmConfig: AgentLLMConfig
  /** V20：workspace 内主 agent（每个 workspace 唯一）；send_llm target='main' 时取此 agent */
  isMain?: boolean
  /** V20：agent 所属 workspace（默认 '' 表示全局 / 兼容存量） */
  workspaceId?: string
  createdAt?: number
  updatedAt?: number
}

/** 工具配置 */
export interface AgentToolConfig {
  enabledTools: Record<string, boolean>
}

/** QQ 绑定 */
export interface QQBinding {
  enabled: boolean
  accountId?: string
  groupIds?: string[]
}

/** 模型配置（UI 管理用） */
export interface ModelConfigItem {
  id: string
  providerId: string
  providerName: string
  modelName: string
  apiKey: string
  baseUrl: string
  enabled: boolean
  contextWindow: number
  supportsFunctionCalling: boolean
  createdAt: number
}

/** 上下文 Token 信息 */
export interface ContextTokenInfo {
  used: number
  max: number
  percentage: number
  breakdown: {
    system: number
    history: number
    tools: number
    state: number
  }
}

// ==========================================
// 工作区切换 UI 类型定义
// ==========================================

/** 工作区列表项（UI 展示用，扩展自 WorkspaceInfo） */
export interface WorkspaceItem {
  id: string
  name: string
  alias?: string
  state: 'online' | 'offline' | 'connecting'
  edition: 'bedrock' | 'java'
  host: string
  port: number
  toolCount: number
  filePath?: string             // alice-mod_instance.json 文件路径   
  gameVersion?: string          // 游戏版本号，如 "1.26.10"
  iconData?: string             // 自定义图标 base64 data URL
  protocolVersion?: string
  modVersion?: string
  description?: string
  tags?: string[]
  lastActiveAt?: number
  createdAt: number
}

/** 世界上下文列表项（UI 展示用） */
export interface WorldItem {
  id: string
  instanceId: string
  worldName: string
  state: 'online' | 'offline' | 'connecting'
  edition: 'bedrock' | 'java'
  gameVersion: string
  botCount: number
  uptimeSeconds: number
  lastOnlineAt?: number
}

/** 新建工作区 — 文件校验结果 */
export interface WorkspaceFileValidation {
  valid: boolean
  errors: string[]
  instance?: {
    instanceId: string
    name: string
    edition: 'bedrock' | 'java'
    host: string
    port: number
    authToken: string
    filePath?: string
    gameVersion?: string
    description?: string
    tags?: string[]
  }
  isDuplicate?: boolean
  duplicateName?: string
}

/** 新建工作区 — 创建参数 */
export interface WorkspaceCreateParams {
  filePath: string
  name?: string
  iconData?: string
  alias?: string
  description?: string
  tags?: string[]
}

/** 窗口控制 API */
export interface WindowControls {
  minimize: () => Promise<void>
  maximize: () => Promise<boolean>
  close: () => Promise<void>
  isMaximized: () => Promise<boolean>
}

/** Electron API 暴露给渲染进程的接口 */
export interface ElectronAPI {
  platform: string
  send: (channel: string, ...args: unknown[]) => void
  on: (channel: string, callback: (...args: unknown[]) => void) => () => void
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
  window: WindowControls
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

// ==========================================
// V16 智能体创建向导 — 新增类型
// ==========================================

/** 向导表单数据 */
export interface WizardFormData {
  name: string
  alias: string
  skinData?: string
  personaMode: 'preset' | 'advanced'
  personaPresetId?: string
  persona: AgentPersona
  enabledTools: Record<string, boolean>
  qqBinding: QQBinding
  llmConfig: AgentLLMConfig
}

/** 人设配置 */
export interface AgentPersona {
  identity: string
  expertise: string[]
  personality: string[]
  workflowId: string
  behaviorRules?: {
    core: string[]
    strategy: StrategyRule[]
    constraints: ConstraintRule[]
  }
  /** 沟通风格（V19 新增，高级模式自定义） */
  communicationStyle?: string[]
  /** 行为边界（V19 新增，高级模式自定义） */
  boundaries?: string[]
}

/** 人设预设 */
export interface PersonaPreset {
  id: string
  name: string
  description: string
  identity: string
  expertise: string[]
  personality: string[]
  workflowId: string
  behaviorRules: {
    core: string[]
    strategy: StrategyRule[]
    constraints: ConstraintRule[]
  }
  recommendedToolCategories: string[]
  isBuiltin: boolean
  createdAt?: number
}

/** LLM 模型配置 */
export interface AgentLLMConfig {
  mainModel: ModelSelection
  qqBotModel: ModelSelection
  compressionModel: ModelSelection
}

/** 模型选择 */
export interface ModelSelection {
  providerId: string
  modelId: string
  modelName: string
  sameAsMain?: boolean
}

/** 工具展示信息 */
export interface ToolInfo {
  name: string
  displayName: string
  description: string
  category: string
  categoryLabel: string
  parameters: ToolParamInfo[]
  example?: string
}

/** 工具参数信息 */
export interface ToolParamInfo {
  name: string
  type: string
  description: string
  required: boolean
  defaultValue?: unknown
}

/** 策略规则 */
export interface StrategyRule {
  name: string
  description: string
  priority: number
}

/** 约束规则 */
export interface ConstraintRule {
  name: string
  description: string
  consequence: 'warning' | 'block' | 'replan'
}