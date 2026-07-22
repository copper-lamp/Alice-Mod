import type {
  ChatMessage,
  ProviderInfo,
  ModelInfo,
  ConfigEntry,
  WorkspaceInfo,
  WorkspaceItem,
  WorldItem,
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
  ModelConfigItem,
  UpdateInfo
} from './types'

/** IPC 调用封装 - 对话 */
export const chatApi = {
  send: (workspaceId: string, message: string) =>
    window.electronAPI.invoke('chat:send', { workspaceId, message }) as Promise<{ id: string; content: string }>,

  stream: (workspaceId: string, message: string) =>
    window.electronAPI.invoke('chat:stream', { workspaceId, message }) as Promise<void>,

  history: (workspaceId: string, limit?: number, agentId?: string) =>
    window.electronAPI.invoke('chat:history', { workspaceId, limit, agentId }) as Promise<ChatMessage[]>,

  /** V28：获取 QQ 专属 LLM 对话历史 */
  qqHistory: (workspaceId: string, agentId: string, limit?: number) =>
    window.electronAPI.invoke('chat:qq-history', { workspaceId, agentId, limit }) as Promise<ChatMessage[]>,

  /** 清除 QQ 对话历史 */
  clearQQHistory: (workspaceId: string, agentId: string) =>
    window.electronAPI.invoke('chat:clear-qq-history', { workspaceId, agentId }) as Promise<{ success: boolean; deleted?: number; error?: string }>,

  /**
   * V33: 监听 LLM 流式事件（thinking / text / tool_calls / done）
   * agentId 用于标识事件来源，供前端按 agent 过滤显示。
   * 返回取消订阅函数
   */
  onStreamEvent: (callback: (event: { type: 'thinking' | 'text' | 'tool_calls' | 'done'; data?: unknown; agentId?: string }) => void) => {
    return window.electronAPI.on('chat:stream-event', (...args: unknown[]) => {
      const event = args[0] as { type: 'thinking' | 'text' | 'tool_calls' | 'done'; data?: unknown; agentId?: string }
      callback(event)
    })
  },
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

/** IPC 调用封装 - 世界上下文 */
export const worldApi = {
  list: (workspaceId: string) =>
    window.electronAPI.invoke('world:list', { workspaceId }) as Promise<WorldItem[]>,

  setActive: (workspaceId: string, worldName: string) =>
    window.electronAPI.invoke('world:set-active', { workspaceId, worldName }) as Promise<{ success: boolean }>,

  getActive: (workspaceId: string) =>
    window.electronAPI.invoke('world:get-active', { workspaceId }) as Promise<WorldItem | null>,
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

/** IPC 调用封装 — 记忆系统（v2.0 重构版） */
export const memoryApi = {
  // v1.0 旧接口（向后兼容）
  list: (params: { type?: string; branch?: string; tags?: string[]; keywords?: string; limit?: number; offset?: number }) =>
    window.electronAPI?.invoke('memory:list', params) as Promise<{ memories: any[]; total: number; limit: number; offset: number }>,

  store: async (params: { type: string; branch?: string; content: Record<string, unknown>; tags?: string[]; importance?: number }) => {
    if (!window.electronAPI) return { success: false, error: 'Electron API 不可用（浏览器预览模式）' }
    return window.electronAPI.invoke('memory:store', params) as Promise<{ success: boolean; data?: { id: string; createdAt: number }; error?: string }>
  },

  getById: (id: string) =>
    window.electronAPI?.invoke('memory:getById', { id }) as Promise<any | null>,

  update: (id: string, updates: Record<string, unknown>) =>
    window.electronAPI?.invoke('memory:update', { id, updates }) as Promise<{ success: boolean; error?: string }>,

  forget: (id: string) =>
    window.electronAPI?.invoke('memory:forget', { id }) as Promise<{ success: boolean; error?: string }>,

  similar: (query: string, type?: string, limit?: number) =>
    window.electronAPI?.invoke('memory:similar', { query, type, limit }) as Promise<{ memories: any[] }>,

  // v2.0 新接口
  memoryList: (params: { type?: string; tags?: string[]; limit?: number; offset?: number }) =>
    window.electronAPI?.invoke('memory:list', params) as Promise<{ memories: any[]; total: number }>,

  memoryQuery: (params: { keywords?: string[]; query?: string; type?: string; limit?: number }) =>
    window.electronAPI?.invoke('memory:list', params) as Promise<{ memories: any[]; total: number }>,

  memoryEdit: (params: { action: 'create' | 'update' | 'delete'; id?: string; type?: string; name?: string; content?: string; tags?: string[]; importance?: number }) =>
    window.electronAPI?.invoke('memory:edit', params) as Promise<{ success: boolean; id?: string; error?: string }>,
}

/** IPC 调用封装 — 地图路径点（v2.0 新增） */
export const mapsApi = {
  list: (params: { keywords?: string[]; x?: number; z?: number; radius?: number; dimension?: string; limit?: number }) =>
    window.electronAPI?.invoke('maps:list', params) as Promise<{ waypoints: any[]; total: number }>,

  create: (params: { dimension: string; x: number; y: number; z: number; name: string; description?: string; tags?: string[] }) =>
    window.electronAPI?.invoke('maps:create', params) as Promise<{ id: string }>,

  update: (params: { id: string; name?: string; description?: string; tags?: string[] }) =>
    window.electronAPI?.invoke('maps:update', params) as Promise<{ success: boolean }>,

  delete: (id: string) =>
    window.electronAPI?.invoke('maps:delete', { id }) as Promise<{ success: boolean }>,
}

/** IPC 调用封装 — 目标任务（v2.0 新增） */
export const aimApi = {
  list: (params?: { type?: string; status?: string }) =>
    window.electronAPI?.invoke('aim:list', params ?? {}) as Promise<{ tasks: any[] }>,

  get: (id: string) =>
    window.electronAPI?.invoke('aim:get', { id }) as Promise<{ task: any }>,

  create: (params: { type: string; title: string; description: string; items: string[] }) =>
    window.electronAPI?.invoke('aim:create', params) as Promise<{ task: any; error?: string }>,

  update: (params: { id: string; item_id: string; done: boolean }) =>
    window.electronAPI?.invoke('aim:update', params) as Promise<{ task: any }>,

  delete: (id: string) =>
    window.electronAPI?.invoke('aim:delete', { id }) as Promise<{ success: boolean; error?: string }>,
}

/** IPC 调用封装 — 知识库（v2.0 新增） */
export const knowledgeApi = {
  query: (params: { query: string; limit?: number }) =>
    window.electronAPI?.invoke('knowledge:query', params) as Promise<{ results: any[] }>,
}

// ==========================================
// V16: 人设预设 & 工具 API
// ==========================================

import type { PersonaPreset, ToolInfo } from './types'

export const presetApi = {
  list: () => window.electronAPI.invoke('preset:list') as Promise<PersonaPreset[]>,
  get: (id: string) => window.electronAPI.invoke('preset:get', { id }) as Promise<PersonaPreset | null>,
  create: (preset: Omit<PersonaPreset, 'id' | 'isBuiltin' | 'createdAt'>) =>
    window.electronAPI.invoke('preset:create', preset) as Promise<{ id: string; success: boolean }>,
  update: (id: string, preset: Partial<PersonaPreset>) =>
    window.electronAPI.invoke('preset:update', { id, preset }) as Promise<{ success: boolean }>,
  delete: (id: string) =>
    window.electronAPI.invoke('preset:delete', { id }) as Promise<{ success: boolean }>,
}

export const toolApi = {
  listAll: () => window.electronAPI.invoke('tool:list-all') as Promise<ToolInfo[]>,
}

/** IPC 调用封装 — 自动更新 */
export const updaterApi = {
  getState: () => window.electronAPI.updater.getState(),
  checkNow: () => window.electronAPI.updater.checkNow(),
  download: () => window.electronAPI.updater.download(),
  install: () => window.electronAPI.updater.install(),
  onStateChange: (cb: (state: UpdateInfo) => void) => window.electronAPI.updater.onStateChange(cb),
  onUpdateAvailable: (cb: (version: string) => void) => window.electronAPI.updater.onUpdateAvailable(cb),
  onDownloadProgress: (cb: (percent: number) => void) => window.electronAPI.updater.onDownloadProgress(cb),
  onUpdateDownloaded: (cb: () => void) => window.electronAPI.updater.onUpdateDownloaded(cb),
  onUpdateError: (cb: (error: string) => void) => window.electronAPI.updater.onUpdateError(cb),
}