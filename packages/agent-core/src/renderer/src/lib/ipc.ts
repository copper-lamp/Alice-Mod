import type {
  ChatMessage,
  ProviderInfo,
  ModelInfo,
  ConfigEntry,
  WorkspaceInfo,
  WorkspaceItem,
  WorkspaceFileValidation,
  WorkspaceCreateParams,
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
  list: () =>
    window.electronAPI.invoke('workspace:list') as Promise<WorkspaceItem[]>,

  selectFile: () =>
    window.electronAPI.invoke('workspace:select-file') as Promise<{ filePath: string | null }>,

  validateFile: (filePath: string) =>
    window.electronAPI.invoke('workspace:validate-file', { filePath }) as Promise<WorkspaceFileValidation>,

  create: (params: WorkspaceCreateParams) =>
    window.electronAPI.invoke('workspace:create', params) as Promise<{ success: boolean; id?: string; error?: string }>,

  rename: (id: string, name: string) =>
    window.electronAPI.invoke('workspace:rename', { id, name }) as Promise<{ success: boolean }>,

  remove: (id: string, force?: boolean) =>
    window.electronAPI.invoke('workspace:remove', { id, force }) as Promise<{ success: boolean; online?: boolean; message?: string }>,

  openInExplorer: (filePath: string) =>
    window.electronAPI.invoke('workspace:open-in-explorer', { filePath }) as Promise<{ success: boolean }>,

  selectIcon: () =>
    window.electronAPI.invoke('workspace:select-icon') as Promise<{ iconData: string | null; error?: string }>,

  updateIcon: (id: string, iconData?: string) =>
    window.electronAPI.invoke('workspace:update-icon', { id, iconData }) as Promise<{ success: boolean }>,
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

/** IPC 调用封装 - 记忆系统 */
export const memoryApi = {
  list: (params: { type?: string; tags?: string[]; keywords?: string; limit?: number; offset?: number }) =>
    window.electronAPI.invoke('memory:list', params) as Promise<{ memories: any[]; total: number; limit: number; offset: number }>,

  getById: (id: string) =>
    window.electronAPI.invoke('memory:getById', { id }) as Promise<any | null>,

  update: (id: string, updates: Record<string, unknown>) =>
    window.electronAPI.invoke('memory:update', { id, updates }) as Promise<{ success: boolean; error?: string }>,

  forget: (id: string) =>
    window.electronAPI.invoke('memory:forget', { id }) as Promise<{ success: boolean; error?: string }>,

  similar: (query: string, type?: string, limit?: number) =>
    window.electronAPI.invoke('memory:similar', { query, type, limit }) as Promise<{ memories: any[] }>
}