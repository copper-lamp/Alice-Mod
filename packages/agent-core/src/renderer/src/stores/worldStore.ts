import { create } from 'zustand'
import type { WorldItem } from '../lib/types'
import { worldApi } from '../lib/ipc'

interface WorldState {
  // 数据
  worlds: WorldItem[]
  currentWorldId: string | null
  loading: boolean

  // Actions: 列表
  refreshWorlds: (workspaceId: string) => Promise<void>
  setActiveWorld: (workspaceId: string, worldName: string) => Promise<void>

  // Actions: 事件
  handleWorldOnline: (event: { workspaceId: string; worldName: string; instanceId: string }) => void
  handleWorldOffline: (event: { workspaceId: string; worldName: string }) => void
  handleStateChange: (event: { workspaceId: string; worldName: string; state: string }) => void
  handleActiveChanged: (event: { workspaceId: string; worldName: string }) => void

  // 清理
  clearWorlds: () => void
}

export const useWorldStore = create<WorldState>((set, get) => ({
  worlds: [],
  currentWorldId: null,
  loading: false,

  refreshWorlds: async (workspaceId: string) => {
    set({ loading: true })
    try {
      const list = await worldApi.list(workspaceId)
      const currentId = get().currentWorldId
      const stillExists = currentId ? list.some(w => w.id === currentId) : false
      set({
        worlds: list,
        currentWorldId: stillExists ? currentId : (list[0]?.id ?? null),
        loading: false,
      })
    } catch {
      set({ loading: false })
    }
  },

  setActiveWorld: async (workspaceId: string, worldName: string) => {
    try {
      await worldApi.setActive(workspaceId, worldName)
      const worldId = `${workspaceId}:${worldName}`
      set({ currentWorldId: worldId })
      window.dispatchEvent(new CustomEvent('world:changed', {
        detail: { workspaceId, worldName },
      }))
    } catch (err) {
      console.error('Failed to set active world:', err)
    }
  },

  handleWorldOnline: (event) => {
    set(state => {
      const worldId = `${event.workspaceId}:${event.worldName}`
      const exists = state.worlds.some(w => w.id === worldId)
      if (exists) {
        return {
          worlds: state.worlds.map(w =>
            w.id === worldId ? { ...w, state: 'online' as const } : w
          ),
        }
      }
      return {
        worlds: [...state.worlds, {
          id: worldId,
          instanceId: event.instanceId,
          worldName: event.worldName,
          state: 'online' as const,
          edition: 'java' as const,
          gameVersion: '',
          botCount: 0,
          uptimeSeconds: 0,
        }],
        currentWorldId: state.currentWorldId ?? worldId,
      }
    })
  },

  handleWorldOffline: (event) => {
    set(state => ({
      worlds: state.worlds.map(w =>
        w.id === `${event.workspaceId}:${event.worldName}`
          ? { ...w, state: 'offline' as const }
          : w
      ),
    }))
  },

  handleStateChange: (event) => {
    set(state => ({
      worlds: state.worlds.map(w =>
        w.id === `${event.workspaceId}:${event.worldName}`
          ? { ...w, state: event.state as WorldItem['state'] }
          : w
      ),
    }))
  },

  handleActiveChanged: (event) => {
    const worldId = `${event.workspaceId}:${event.worldName}`
    set({ currentWorldId: worldId })
  },

  clearWorlds: () => {
    set({ worlds: [], currentWorldId: null })
  },
}))
