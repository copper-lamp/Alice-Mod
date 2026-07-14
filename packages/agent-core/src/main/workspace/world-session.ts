/**
 * WorldSession — 世界上下文会话数据类
 *
 * 每个 WorldSession 对应一个 Minecraft 世界（存档/维度），
 * 包含该世界的连接状态、会话数据和隔离上下文。
 * 一个工作区（Workspace）下可以有多个 WorldSession。
 */

// ════════════════════════════════════════════════════════════════
// 枚举
// ════════════════════════════════════════════════════════════════

export enum WorldSessionState {
  Offline = 'offline',
  Connecting = 'connecting',
  Online = 'online',
}

// ════════════════════════════════════════════════════════════════
// 接口
// ════════════════════════════════════════════════════════════════

/** 世界上下文持久化数据 */
export interface WorldSessionData {
  id: string
  workspaceId: string
  instanceId: string
  worldName: string
  state: WorldSessionState
  edition: string
  gameVersion: string
  connectedAt: number | null
  lastOnlineAt: number | null
  uptimeSeconds: number
  botCount: number
  createdAt: number
  updatedAt: number
}

/** 世界会话事件数据 */
export interface WorldSessionEvent {
  type: WorldSessionEventType
  workspaceId: string
  instanceId: string
  worldName: string
  timestamp: number
  metadata?: Record<string, unknown>
}

export enum WorldSessionEventType {
  Registered = 'world:registered',
  Online = 'world:online',
  Offline = 'world:offline',
  StateChanged = 'world:state-changed',
  ActiveChanged = 'world:active-changed',
}

// ════════════════════════════════════════════════════════════════
// WorldSession 类
// ════════════════════════════════════════════════════════════════

export class WorldSession {
  readonly id: string
  readonly instanceId: string
  readonly worldName: string
  readonly createdAt: number

  state: WorldSessionState = WorldSessionState.Offline
  edition: string
  gameVersion: string
  connectedAt: number | null = null
  lastOnlineAt: number | null = null
  uptimeSeconds = 0
  botCount = 0
  updatedAt: number

  /** 会话隔离数据 */
  readonly session: {
    conversationHistory: unknown[]
    memoryContext: Record<string, unknown>
  } = {
    conversationHistory: [],
    memoryContext: {},
  }

  constructor(params: {
    instanceId: string
    worldName: string
    edition: string
    gameVersion: string
  }) {
    this.id = `${params.instanceId}:${params.worldName}`
    this.instanceId = params.instanceId
    this.worldName = params.worldName
    this.edition = params.edition
    this.gameVersion = params.gameVersion
    this.createdAt = Date.now()
    this.updatedAt = Date.now()
  }

  get isOnline(): boolean {
    return this.state === WorldSessionState.Online
  }

  goOnline(): void {
    const prevState = this.state
    this.state = WorldSessionState.Online
    this.connectedAt = Date.now()
    this.updatedAt = Date.now()
    this.uptimeSeconds = 0
  }

  goOffline(): void {
    const prevState = this.state
    this.state = WorldSessionState.Offline
    this.lastOnlineAt = Date.now()
    this.uptimeSeconds = this.connectedAt
      ? Math.floor((Date.now() - this.connectedAt) / 1000)
      : 0
    this.updatedAt = Date.now()
  }

  toJSON(): WorldSessionData {
    return {
      id: this.id,
      workspaceId: '',
      instanceId: this.instanceId,
      worldName: this.worldName,
      state: this.state,
      edition: this.edition,
      gameVersion: this.gameVersion,
      connectedAt: this.connectedAt,
      lastOnlineAt: this.lastOnlineAt,
      uptimeSeconds: this.uptimeSeconds,
      botCount: this.botCount,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    }
  }
}