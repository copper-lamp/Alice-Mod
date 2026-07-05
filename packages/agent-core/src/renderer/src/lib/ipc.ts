import type {
  ChatMessage,
  ProviderInfo,
  ModelInfo,
  ConfigEntry,
  WorkspaceInfo,
  TcpStatus,
  UsageStats,
  ContextTokenInfo,
  DashboardStats,
  DailyUsage,
  ActivityData,
  AgentSummary,
  AgentConfig,
  ModelConfigItem
} from './types'

/** IPC 调用封装 - 对话 */
export const chatApi = {
  send: (workspaceId: string, message: string) =>
    window.electronAPI.invoke('chat:send', { workspaceId, message }) as Promise<{ id: string; content: string }>,

  stream: (workspaceId: string, message: string) =>
    window.electronAPI.invoke('chat:stream', { workspaceId, message }) as Promise<void>,

  history: (workspaceId: string, limit?: number) =>
    window.electronAPI.invoke('chat:history', { workspaceId, limit }) as Promise<ChatMessage[]>
}

/** IPC 调用封装 - 配置 */
export const configApi = {
  get: (key: string) =>
    window.electronAPI.invoke('config:get', { key }) as Promise<ConfigEntry>,

  set: (key: string, value: string) =>
    window.electronAPI.invoke('config:set', { key, value }) as Promise<{ success: boolean }>,

  getAll: () =>
    window.electronAPI.invoke('config:getAll') as Promise<ConfigEntry[]>,

  getProviders: () =>
    window.electronAPI.invoke('provider:list') as Promise<ProviderInfo[]>,

  getModels: (providerId: string) =>
    window.electronAPI.invoke('model:list', { providerId }) as Promise<ModelInfo[]>
}

/** IPC 调用封装 - 窗口控制 */
export const windowApi = {
  minimize: () => window.electronAPI.window.minimize(),
  maximize: () => window.electronAPI.window.maximize(),
  close: () => window.electronAPI.window.close(),
  isMaximized: () => window.electronAPI.window.isMaximized()
}

/** IPC 调用封装 - 工作区 */
export const workspaceApi = {
  current: () =>
    window.electronAPI.invoke('workspace:current') as Promise<WorkspaceInfo>,

  list: () =>
    window.electronAPI.invoke('workspace:list') as Promise<WorkspaceInfo[]>
}

/** IPC 调用封装 - TCP */
export const tcpApi = {
  status: () =>
    window.electronAPI.invoke('tcp:status') as Promise<TcpStatus>
}

/** IPC 调用封装 - LLM 监控 */
export const llmApi = {
  usage: (period: string) =>
    window.electronAPI.invoke('llm:usage', { period }) as Promise<UsageStats>,

  contextTokens: (workspaceId: string) =>
    window.electronAPI.invoke('llm:context-tokens', { workspaceId }) as Promise<ContextTokenInfo>
}

/** IPC 调用封装 - 仪表盘 */
export const dashboardApi = {
  stats: () =>
    window.electronAPI.invoke('dashboard:stats') as Promise<DashboardStats>,

  usageHistory: (days: number) =>
    window.electronAPI.invoke('dashboard:usage-history', { days }) as Promise<DailyUsage[]>,

  agentActivity: () =>
    window.electronAPI.invoke('dashboard:agent-activity') as Promise<ActivityData[]>
}

/** IPC 调用封装 - 智能体 */
export const agentApi = {
  list: () =>
    window.electronAPI.invoke('agent:list') as Promise<AgentSummary[]>,

  get: (id: string) =>
    window.electronAPI.invoke('agent:get', { id }) as Promise<AgentConfig | null>,

  create: (config: AgentConfig) =>
    window.electronAPI.invoke('agent:create', config) as Promise<{ id: string; success: boolean }>,

  update: (id: string, config: Partial<AgentConfig>) =>
    window.electronAPI.invoke('agent:update', { id, config }) as Promise<{ success: boolean }>,

  delete: (id: string) =>
    window.electronAPI.invoke('agent:delete', { id }) as Promise<{ success: boolean }>
}

/** IPC 调用封装 - 模型管理 */
export const modelApi = {
  list: () =>
    window.electronAPI.invoke('model:list') as Promise<ModelConfigItem[]>,

  add: (config: ModelConfigItem) =>
    window.electronAPI.invoke('model:add', config) as Promise<{ success: boolean }>,

  remove: (id: string) =>
    window.electronAPI.invoke('model:remove', { id }) as Promise<{ success: boolean }>,

  update: (id: string, config: Partial<ModelConfigItem>) =>
    window.electronAPI.invoke('model:update', { id, config }) as Promise<{ success: boolean }>
}