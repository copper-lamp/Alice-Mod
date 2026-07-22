/**
 * 诊断信息打包工具 - 类型定义
 */

/** 诊断信息包（包含所有采集的数据） */
export interface DiagnoseInfo {
  /** 基础环境信息 */
  info: EnvironmentInfo
  /** 配置快照（脱敏） */
  config: Record<string, unknown>
  /** 日志文本 */
  logs: string
  /** 工具调用历史（紧凑 JSON 字符串） */
  toolCalls: string
  /** 游戏状态 */
  gameState: GameStateInfo
  /** 工作区列表 */
  workspaces: WorkspaceInfo[]
  /** 性能指标 */
  performance: PerformanceMetrics
  /** LLM 调用统计 */
  llmStats: LlmStatsInfo
  /** LLM 调用明细（紧凑 JSON） */
  llmRecords: string
  /** 错误汇总 */
  errorSummary: ErrorSummaryInfo
  /** QQ Bot 统计 */
  qqBotStats: QQBotStatsInfo
  /** Agent 统计 */
  agentStats: AgentStatsInfo
  /** 记忆系统统计 */
  memoryStats: MemoryStatsInfo
  /** 网络连接统计 */
  networkStats: NetworkStatsInfo
  /** 事件时间线 */
  eventTimeline: TimelineEntry[]
  /** 数据库表概览 */
  databaseSchema: DatabaseSchemaInfo
  /** 详细系统信息 */
  systemDetail: SystemDetailInfo
}

/** 基础环境信息 */
export interface EnvironmentInfo {
  agentVersion: string
  buildTime: string
  os: string
  osVersion: string
  nodeVersion: string
  electronVersion: string
  chromeVersion: string
  v8Version: string
  cpuModel: string
  cpuCores: number
  totalMemory: number
  freeMemory: number
  adapterTypes: string[]
  uptimeSeconds: number
  processStartTime: number
  memoryUsage: { heapUsed: number; heapTotal: number; rss: number; external: number; arrayBuffers: number }
  lastExitCode?: number
  lastRunCrashed?: boolean
  /** 诊断包生成次数 */
  generationCount: number
}

/** 游戏状态 */
export interface GameStateInfo {
  connected: boolean
  dimension?: string
  health?: number
  hunger?: number
  position?: { x: number; y: number; z: number }
  adapterType?: string
  clientVersion?: string
  protocolVersion?: string
}

/** 工作区信息 */
export interface WorkspaceInfo {
  id: string
  name: string
  instanceId: string
  adapterType: string | null
  connected: boolean
  connectionId: string | null
  toolsRegistered: number
  uptimeSeconds: number
  createdAt: number
  lastOnlineAt: number | null
  state: string
  edition: string | null
  modVersion: string | null
}

/** 性能指标 */
export interface PerformanceMetrics {
  /** 当前内存使用 */
  memory: {
    heapUsed: number
    heapTotal: number
    rss: number
    external: number
    arrayBuffers: number
    heapUsedPercent: number
  }
  /** CPU 使用（从启动开始累计） */
  cpu: {
    user: number
    system: number
    percentUsage: number
  }
  /** 事件循环延迟采样（ms） */
  eventLoopLag: {
    min: number
    max: number
    avg: number
    samples: number[]
  }
  /** GC 统计 */
  gc: {
    totalCollections: number
    totalDurationMs: number
    avgCollectionMs: number
  }
  /** 进程句柄数 */
  handleCount: number
  /** 活跃线程数 */
  activeHandles: number
  activeRequests: number
}

/** LLM 统计 */
export interface LlmStatsInfo {
  /** 聚合统计 */
  summary: {
    totalCalls: number
    totalTokens: number
    totalPromptTokens: number
    totalCompletionTokens: number
    totalCachedTokens: number
    avgDurationMs: number
    successRate: number
    totalCost: number
    timeRange: { start: number; end: number }
  }
  /** 按 Provider 统计 */
  byProvider: Record<string, {
    callCount: number
    totalTokens: number
    avgDurationMs: number
    successRate: number
    totalPromptTokens: number
    totalCompletionTokens: number
  }>
  /** 按 Model 统计 */
  byModel: Record<string, {
    callCount: number
    totalTokens: number
    avgDurationMs: number
    successRate: number
    totalPromptTokens: number
    totalCompletionTokens: number
  }>
  /** 按小时分布 */
  hourlyDistribution: Record<string, number>
  /** Token 趋势（每 10 条一组） */
  tokenTrend: Array<{ timestamp: number; totalTokens: number; durationMs: number; success: boolean }>
  /** 失败详情 */
  failures: Array<{ providerId: string; model: string; error: string; timestamp: number }>
}

/** LLM 调用记录（导出用） */
export interface LlmRecordExport {
  providerId: string
  model: string
  success: boolean
  promptTokens: number
  completionTokens: number
  totalTokens: number
  durationMs: number
  error: string | undefined
  timestamp: number
}

/** 错误汇总 */
export interface ErrorSummaryInfo {
  totalErrors: number
  totalWarnings: number
  /** 按模块分布 */
  byModule: Record<string, { errors: number; warnings: number }>
  /** 按级别分布 */
  byLevel: Record<string, number>
  /** 按小时分布 */
  hourlyDistribution: Record<string, number>
  /** 常见错误消息 TOP 20 */
  topErrorMessages: Array<{ message: string; count: number; module: string }>
  /** 工具调用错误统计 */
  toolErrors: Array<{ toolName: string; errorCount: number; avgDurationMs: number }>
  /** LLM 错误统计 */
  llmErrors: Array<{ providerId: string; model: string; errorCount: number; commonErrors: Record<string, number> }>
  /** 错误趋势（每 1000 条日志一组） */
  errorRate: Array<{ startTime: number; errors: number; total: number; rate: number }>
}

/** QQ Bot 统计 */
export interface QQBotStatsInfo {
  /** 账号信息 */
  accounts: Array<{
    accountId: string
    name: string
    platform: string
    connected: boolean
    uptimeSeconds: number
  }>
  /** 消息统计 */
  messages: {
    totalIncoming: number
    totalOutgoing: number
    byType: Record<string, { incoming: number; outgoing: number }>
    byUser: Record<string, { incoming: number; outgoing: number }>
    hourlyDistribution: Record<string, number>
    avgResponseTimeMs: number
  }
  /** 频率限制统计 */
  rateLimit: {
    totalLimited: number
    byUser: Record<string, number>
  }
}

/** Agent 统计 */
export interface AgentStatsInfo {
  totalAgents: number
  enabledAgents: number
  mainAgents: number
  qqBoundAgents: number
  agents: Array<{
    id: string
    name: string
    enabled: boolean
    isMain: boolean
    qqBound: boolean
    toolCount: number
    workspaceId: string | undefined
    modelProvider: string
    modelName: string
  }>
}

/** 记忆系统统计 */
export interface MemoryStatsInfo {
  totalMemories: number
  byType: Record<string, number>
  byBranch: Record<string, number>
  byImportance: Record<string, number>
  totalTags: number
  totalMapFeatures: number
  totalRegions: number
  recentMemories: number
  memoryAge: { minDays: number; maxDays: number; avgDays: number }
}

/** 网络连接统计 */
export interface NetworkStatsInfo {
  tcpServer: {
    port: number
    host: string
    isListening: boolean
    totalConnections: number
    currentConnections: number
  }
  connections: Array<{
    clientId: string
    instanceId: string
    address: string
    state: string
    connectedAt: number
    uptimeSeconds: number
  }>
}

/** 事件时间线条目 */
export interface TimelineEntry {
  timestamp: number
  type: 'boot' | 'connection' | 'disconnect' | 'error' | 'tool_call' | 'llm_call' | 'qq_message' | 'trigger' | 'diagnose'
  summary: string
  detail?: string
}

/** 数据库表概览 */
export interface DatabaseSchemaInfo {
  totalTables: number
  tables: Array<{
    name: string
    rowCount: number
    columns: string[]
    sizeBytes: number
  }>
  dbSizeBytes: number
  dbPath: string
}

/** 详细系统信息 */
export interface SystemDetailInfo {
  hostname: string
  platform: string
  arch: string
  release: string
  type: string
  uptime: number
  loadavg: number[]
  networkInterfaces: Record<string, Array<{ address: string; netmask: string; family: string; mac: string; internal: boolean }>>
  env: Record<string, string>
  cwd: string
  execPath: string
  pid: number
  ppid: number
  versions: Record<string, string>
  commandLineArgs: string[]
  /** 系统语言环境 */
  locale: string
  /** 时区 */
  timezone: string
  /** Electron 相关路径 */
  paths: {
    userData: string
    appData: string
    home: string
    desktop: string
    downloads: string
    logs: string
    exe: string
  }
}

/** 诊断模块配置 */
export interface DiagnoseConfig {
  outputDir: string
  maxKeep: number
  maxLogBytes: number
  toolCallCount: number
  maxZipSize: number
  intervalMs: number
  strictMaxLogBytes: number
  strictToolCallCount: number
  /** LLM 记录导出条数 */
  llmRecordCount: number
  /** 日志查询条数上限 */
  logQueryLimit: number
  /** 是否采集详细性能指标 */
  collectPerfMetrics: boolean
  /** 是否采集事件时间线 */
  collectTimeline: boolean
}