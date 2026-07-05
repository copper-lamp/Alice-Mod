import { create } from 'zustand'
import type { AgentSummary, AgentConfig } from '../lib/types'

interface AgentState {
  agents: AgentSummary[]
  currentAgentId: string | null
  currentAgent: AgentConfig | null
  loading: boolean

  setCurrentAgentId: (id: string | null) => void
  refreshAgents: () => Promise<void>
  fetchAgent: (id: string) => Promise<void>
  createAgent: (config: AgentConfig) => Promise<string>
  updateAgent: (id: string, config: Partial<AgentConfig>) => Promise<void>
  deleteAgent: (id: string) => Promise<void>
}

export const useAgentStore = create<AgentState>((set, get) => ({
  agents: [],
  currentAgentId: null,
  currentAgent: null,
  loading: false,

  setCurrentAgentId: (id) => set({ currentAgentId: id }),

  refreshAgents: async () => {
    try {
      const list = await window.electronAPI.invoke('agent:list') as AgentSummary[]
      set({ agents: list })
    } catch {
      // ignore
    }
  },

  fetchAgent: async (id) => {
    set({ loading: true })
    try {
      const config = await window.electronAPI.invoke('agent:get', { id }) as AgentConfig | null
      set({ currentAgent: config, loading: false })
    } catch {
      set({ loading: false })
    }
  },

  createAgent: async (config) => {
    try {
      const result = await window.electronAPI.invoke('agent:create', config) as { id: string; success: boolean }
      if (result.success) {
        await get().refreshAgents()
        set({ currentAgentId: result.id })
      }
      return result.id
    } catch {
      return ''
    }
  },

  updateAgent: async (id, config) => {
    try {
      await window.electronAPI.invoke('agent:update', { id, config })
      await get().fetchAgent(id)
    } catch {
      // ignore
    }
  },

  deleteAgent: async (id) => {
    try {
      await window.electronAPI.invoke('agent:delete', { id })
      const { currentAgentId } = get()
      set({
        currentAgentId: currentAgentId === id ? null : currentAgentId
      })
      await get().refreshAgents()
    } catch {
      // ignore
    }
  }
}))