/**
 * 诊断信息打包工具 - 类型定义
 */

/** 诊断信息包 */
export interface DiagnoseInfo {
  info: EnvironmentInfo
  config: Record<string, unknown>
  logs: string
  toolCalls: string
  gameState: GameStateInfo
  workspaces: WorkspaceInfo[]
}

/** 环境信息 */
export interface EnvironmentInfo {
  agentVersion: string
  buildTime: string
  os: string
  nodeVersion: string
  electronVersion: string
  adapterTypes: string[]
  uptimeSeconds: number
  memoryUsage: { heapUsed: number; heapTotal: number; rss: number }
  lastExitCode?: number
  lastRunCrashed?: boolean
}

/** 游戏状态 */
export interface GameStateInfo {
  connected: boolean
  dimension?: string
  health?: number
  hunger?: number
  position?: { x: number; y: number; z: number }
  adapterType?: string
}

/** 工作区信息 */
export interface WorkspaceInfo {
  id: string
  name: string
  adapterType: string | null
  connected: boolean
  toolsRegistered: number
  uptimeSeconds: number
}

/** 诊断模块配置 */
export interface DiagnoseConfig {
  /** 诊断输出目录 */
  outputDir: string
  /** 保留最近几份诊断包 */
  maxKeep: number
  /** 日志截断大小（字节） */
  maxLogBytes: number
  /** 工具调用记录条数 */
  toolCallCount: number
  /** ZIP 最大体积（字节） */
  maxZipSize: number
  /** 定时生成间隔（毫秒） */
  intervalMs: number
  /** 严格模式日志截断大小 */
  strictMaxLogBytes: number
  /** 严格模式工具调用记录条数 */
  strictToolCallCount: number
}