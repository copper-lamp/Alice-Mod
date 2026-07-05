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
}

/** 智能体完整配置 */
export interface AgentConfig {
  id?: string
  name: string
  skinData?: string
  modelId?: string
  identity: AgentIdentity
  tools: AgentToolConfig
  memory: AgentMemoryConfig
  executionRules: ExecutionRule[]
  qqBinding: QQBinding
  schedule: AgentSchedule
  createdAt?: number
  updatedAt?: number
}

/** 身份/提示词配置 */
export interface AgentIdentity {
  selectedFragments: string[]
  customPrompt?: string
}

/** 工具配置 */
export interface AgentToolConfig {
  categorySelection: Record<string, boolean>
  customToolIds?: string[]
}

/** 记忆配置 */
export interface AgentMemoryConfig {
  mode: 'sqlite' | 'chroma' | 'both'
}

/** 执行规则 */
export interface ExecutionRule {
  id: string
  name: string
  description: string
  enabled: boolean
  params?: Record<string, unknown>
}

/** QQ 绑定 */
export interface QQBinding {
  enabled: boolean
  accountId?: string
  groupIds?: string[]
}

/** 智能体启用时间 */
export interface AgentSchedule {
  mode: 'always' | 'scheduled'
  startTime?: string
  endTime?: string
  timezone?: string
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