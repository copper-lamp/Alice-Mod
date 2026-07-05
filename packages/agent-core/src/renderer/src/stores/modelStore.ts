import { create } from 'zustand'
import type { ModelConfigItem } from '../lib/types'

interface ModelState {
  models: ModelConfigItem[]
  loading: boolean

  fetchModels: () => Promise<void>
  addModel: (config: ModelConfigItem) => Promise<boolean>
  removeModel: (id: string) => Promise<boolean>
  updateModel: (id: string, config: Partial<ModelConfigItem>) => Promise<boolean>
}

export const useModelStore = create<ModelState>((set, get) => ({
  models: [],
  loading: false,

  fetchModels: async () => {
    set({ loading: true })
    try {
      const models = await window.electronAPI.invoke('model:list') as ModelConfigItem[]
      set({ models, loading: false })
    } catch {
      set({ loading: false })
    }
  },

  addModel: async (config) => {
    try {
      const { success } = await window.electronAPI.invoke('model:add', config) as { success: boolean }
      if (success) await get().fetchModels()
      return success
    } catch {
      return false
    }
  },

  removeModel: async (id) => {
    try {
      const { success } = await window.electronAPI.invoke('model:remove', { id }) as { success: boolean }
      if (success) {
        set(s => ({ models: s.models.filter(m => m.id !== id) }))
      }
      return success
    } catch {
      return false
    }
  },

  updateModel: async (id, config) => {
    try {
      const { success } = await window.electronAPI.invoke('model:update', { id, config }) as { success: boolean }
      if (success) {
        set(s => ({
          models: s.models.map(m => m.id === id ? { ...m, ...config } : m)
        }))
      }
      return success
    } catch {
      return false
    }
  }
}))