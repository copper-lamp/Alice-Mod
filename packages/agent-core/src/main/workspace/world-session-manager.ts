/**
 * WorldSessionManager — 世界上下文会话管理器
 *
 * 核心职责：
 * 1. 管理所有 WorldSession 的生命周期（创建/切换/下线）
 * 2. 维护工作区 ↔ 世界列表的映射关系
 * 3. 维护当前活跃的世界上下文
 * 4. 发出生命周期事件供上层模块监听
 */

import { EventEmitter } from 'node:events'
import { WorldSession, WorldSessionState, WorldSessionEventType, type WorldSessionEvent } from './world-session'
export { WorldSessionEventType }
import { WorldStore } from './world-store'

// ════════════════════════════════════════════════════════════════
// WorldSessionManager
// ════════════════════════════════════════════════════════════════

export class WorldSessionManager extends EventEmitter {
  /** workspaceId → Map<worldName, WorldSession> */
  private readonly worldIndex: Map<string, Map<string, WorldSession>> = new Map()

  /** 当前活跃世界: { workspaceId, worldName } */
  private activeWorld: { workspaceId: string; worldName: string } | null = null

  private readonly store: WorldStore | null

  constructor(enablePersistence: boolean = true) {
    super()
    this.store = enablePersistence ? new WorldStore() : null
  }

  // ── 注册 ──

  /**
   * 注册世界上下文
   *
   * 在 handshake 或 world_online 通知时调用。
   * 如果 worldName 已存在，则恢复会话（保留已有会话上下文）。
   */
  registerWorld(workspaceId: string, params: {
    instanceId: string
    worldName: string
    edition: string
    gameVersion: string
  }): WorldSession {
    let worlds = this.worldIndex.get(workspaceId)
    if (!worlds) {
      worlds = new Map()
      this.worldIndex.set(workspaceId, worlds)
    }

    let session = worlds.get(params.worldName)
    if (session) {
      // 恢复已有会话，更新版本信息
      session.edition = params.edition
      session.gameVersion = params.gameVersion
    } else {
      // 创建新会话
      session = new WorldSession({
        instanceId: params.instanceId,
        worldName: params.worldName,
        edition: params.edition,
        gameVersion: params.gameVersion,
      })
      worlds.set(params.worldName, session)
    }

    this.emitEvent(WorldSessionEventType.Registered, workspaceId, params.instanceId, params.worldName)
    return session
  }

  // ── 状态管理 ──

  /**
   * 标记世界上线
   *
   * 收到 world_online 通知时调用。
   * 自动将世界设为当前活跃世界。
   */
  setWorldOnline(workspaceId: string, worldName: string): WorldSession | undefined {
    const session = this.getWorld(workspaceId, worldName)
    if (!session) return undefined

    const oldState = session.state
    session.goOnline()
    this.persistSession(workspaceId, session)

    this.emitEvent(WorldSessionEventType.Online, workspaceId, session.instanceId, worldName)
    if (oldState !== WorldSessionState.Online) {
      this.emitEvent(WorldSessionEventType.StateChanged, workspaceId, session.instanceId, worldName, {
        oldState,
        newState: WorldSessionState.Online,
      })
    }

    // 自动设为活跃世界
    this.setActiveWorld(workspaceId, worldName)

    return session
  }

  /**
   * 标记世界下线
   *
   * 收到 world_offline 通知时调用。
   * 如果当前活跃世界下线，清空活跃标记。
   */
  setWorldOffline(workspaceId: string, worldName: string, reason?: string): WorldSession | undefined {
    const session = this.getWorld(workspaceId, worldName)
    if (!session) return undefined

    const oldState = session.state
    session.goOffline()
    this.persistSession(workspaceId, session)

    this.emitEvent(WorldSessionEventType.Offline, workspaceId, session.instanceId, worldName, { reason })
    if (oldState !== WorldSessionState.Offline) {
      this.emitEvent(WorldSessionEventType.StateChanged, workspaceId, session.instanceId, worldName, {
        oldState,
        newState: WorldSessionState.Offline,
        reason,
      })
    }

    // 如果当前活跃世界下线，清空活跃标记
    if (this.activeWorld?.workspaceId === workspaceId && this.activeWorld?.worldName === worldName) {
      this.activeWorld = null
    }

    return session
  }

  /**
   * 切换当前活跃世界
   *
   * 世界切换时调用，切换后上层模块（LLM 引擎、对话系统）
   * 应监听 WorldSessionEventType.ActiveChanged 事件做出响应。
   */
  setActiveWorld(workspaceId: string, worldName: string): WorldSession | undefined {
    const session = this.getWorld(workspaceId, worldName)
    if (!session) return undefined

    this.activeWorld = { workspaceId, worldName }
    this.emitEvent(WorldSessionEventType.ActiveChanged, workspaceId, session.instanceId, worldName)
    return session
  }

  // ── 查询 ──

  /** 获取当前活跃世界 */
  getActiveWorld(): { workspaceId: string; worldName: string } | null {
    return this.activeWorld
  }

  /** 获取当前活跃世界的 WorldSession */
  getActiveWorldSession(): WorldSession | null {
    if (!this.activeWorld) return null
    return this.getWorld(this.activeWorld.workspaceId, this.activeWorld.worldName) ?? null
  }

  /** 获取工作区下的所有世界 */
  getWorldsByWorkspace(workspaceId: string): WorldSession[] {
    const worlds = this.worldIndex.get(workspaceId)
    if (!worlds) return []
    return Array.from(worlds.values())
  }

  /** 获取工作区下指定世界 */
  getWorld(workspaceId: string, worldName: string): WorldSession | undefined {
    return this.worldIndex.get(workspaceId)?.get(worldName)
  }

  /** 获取工作区下的世界数量 */
  getWorldCount(workspaceId: string): number {
    return this.worldIndex.get(workspaceId)?.size ?? 0
  }

  /** 判断工作区是否有多个世界 */
  hasMultipleWorlds(workspaceId: string): boolean {
    return this.getWorldCount(workspaceId) > 1
  }

  /** 清理工作区下的所有世界（工作区删除时调用） */
  removeWorkspaceWorlds(workspaceId: string): void {
    const worlds = this.worldIndex.get(workspaceId)
    if (worlds) {
      for (const [, session] of worlds) {
        this.store?.delete(session.id)
      }
      this.worldIndex.delete(workspaceId)
    }

    if (this.activeWorld?.workspaceId === workspaceId) {
      this.activeWorld = null
    }
  }

  // ── 持久化 ──

  /**
   * 加载已持久化的世界列表
   *
   * 在工作区恢复时调用，将之前持久化的世界数据恢复为离线状态。
   */
  loadPersistedWorlds(workspaceId: string): void {
    if (!this.store) return

    const persisted = this.store.getAllByWorkspace(workspaceId)
    for (const data of persisted) {
      const session = new WorldSession({
        instanceId: data.instanceId,
        worldName: data.worldName,
        edition: data.edition,
        gameVersion: data.gameVersion,
      })
      session.state = WorldSessionState.Offline
      session.lastOnlineAt = data.lastOnlineAt
      session.uptimeSeconds = data.uptimeSeconds
      session.botCount = data.botCount

      let worlds = this.worldIndex.get(workspaceId)
      if (!worlds) {
        worlds = new Map()
        this.worldIndex.set(workspaceId, worlds)
      }
      worlds.set(data.worldName, session)
    }
  }

  // ── 内部方法 ──

  private persistSession(workspaceId: string, session: WorldSession): void {
    if (!this.store) return
    const data = session.toJSON()
    data.workspaceId = workspaceId
    this.store.save(data)
  }

  private emitEvent(
    type: WorldSessionEventType,
    workspaceId: string,
    instanceId: string,
    worldName: string,
    metadata?: Record<string, unknown>,
  ): void {
    const event: WorldSessionEvent = {
      type,
      workspaceId,
      instanceId,
      worldName,
      timestamp: Date.now(),
      metadata,
    }
    this.emit(type, event)
    this.emit('world:event', event)
  }
}

// ════════════════════════════════════════════════════════════════
// 全局单例
// ════════════════════════════════════════════════════════════════

let sessionManagerInstance: WorldSessionManager | null = null

export function getWorldSessionManager(): WorldSessionManager {
  if (!sessionManagerInstance) {
    sessionManagerInstance = new WorldSessionManager()
  }
  return sessionManagerInstance
}

export function setWorldSessionManager(manager: WorldSessionManager): void {
  sessionManagerInstance = manager
}

export function resetWorldSessionManager(): void {
  sessionManagerInstance = null
}