/**
 * 世界上下文 IPC Handler
 *
 * 处理世界列表查询、世界切换等操作，
 * 以及世界状态事件推送。
 */

import { ipcMain, BrowserWindow } from 'electron'
import { getWorldSessionManager, WorldSessionEventType } from '../workspace/world-session-manager'
import type { WorldSession } from '../workspace/world-session'

// ════════════════════════════════════════════════════════════════
// 前端展示类型
// ════════════════════════════════════════════════════════════════

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

function sessionToWorldItem(session: WorldSession): WorldItem {
  return {
    id: session.id,
    instanceId: session.instanceId,
    worldName: session.worldName,
    state: session.state as WorldItem['state'],
    edition: session.edition as WorldItem['edition'],
    gameVersion: session.gameVersion,
    botCount: session.botCount,
    uptimeSeconds: session.uptimeSeconds,
    lastOnlineAt: session.lastOnlineAt ?? undefined,
  }
}

// ════════════════════════════════════════════════════════════════
// 注册 IPC Handler
// ════════════════════════════════════════════════════════════════

export function registerWorldHandlers(mainWindow?: BrowserWindow): void {
  const manager = getWorldSessionManager()

  // ── 查询 ──

  /** 获取工作区下的世界列表 */
  ipcMain.handle('world:list', async (_event, { workspaceId }: { workspaceId: string }): Promise<WorldItem[]> => {
    const sessions = manager.getWorldsByWorkspace(workspaceId)
    return sessions.map(sessionToWorldItem)
  })

  /** 切换活跃世界 */
  ipcMain.handle('world:set-active', async (_event, { workspaceId, worldName }: { workspaceId: string; worldName: string }): Promise<{ success: boolean }> => {
    const session = manager.setActiveWorld(workspaceId, worldName)
    return { success: !!session }
  })

  /** 获取当前活跃世界 */
  ipcMain.handle('world:get-active', async (_event, { workspaceId }: { workspaceId: string }): Promise<WorldItem | null> => {
    const active = manager.getActiveWorld()
    if (!active || active.workspaceId !== workspaceId) return null
    const session = manager.getWorld(workspaceId, active.worldName)
    if (!session) return null
    return sessionToWorldItem(session)
  })

  // ── 事件推送 ──

  manager.on(WorldSessionEventType.Online, (event) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('world:online', {
        workspaceId: event.workspaceId,
        instanceId: event.instanceId,
        worldName: event.worldName,
        botCount: event.metadata?.botCount ?? 0,
      })
    }
  })

  manager.on(WorldSessionEventType.Offline, (event) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('world:offline', {
        workspaceId: event.workspaceId,
        instanceId: event.instanceId,
        worldName: event.worldName,
        reason: (event.metadata?.reason as string) ?? undefined,
      })
    }
  })

  manager.on(WorldSessionEventType.StateChanged, (event) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('world:state-changed', {
        workspaceId: event.workspaceId,
        worldName: event.worldName,
        state: event.metadata?.newState,
        oldState: event.metadata?.oldState,
        reason: (event.metadata?.reason as string) ?? undefined,
      })
    }
  })

  manager.on(WorldSessionEventType.ActiveChanged, (event) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('world:active-changed', {
        workspaceId: event.workspaceId,
        worldName: event.worldName,
      })
    }
  })
}