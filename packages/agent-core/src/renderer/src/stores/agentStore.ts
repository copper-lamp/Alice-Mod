import { create } from 'zustand'
import type { AgentSummary, AgentConfig } from '../lib/types'
import { agentApi } from '../lib/ipc'

interface AgentState {
  agents: AgentSummary[]
  currentAgentId: string | null
  currentAgent: AgentConfig | null
  loading: boolean
  error: string | null

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
  error: null,

  setCurrentAgentId: (id) => set({
    currentAgentId: id,
    currentAgent: null,
    loading: id !== null,
    error: null
  }),

  refreshAgents: async () => {
    try {
      const list = await agentApi.list()
      set({ agents: list })
    } catch {
      // 列表刷新失败时保留已有摘要
    }
  },

  fetchAgent: async (id) => {
    set({ loading: true, error: null })
    try {
      const config = await agentApi.get(id)
      if (get().currentAgentId === id) {
        set({ currentAgent: config, loading: false })
      }
    } catch (error) {
      if (get().currentAgentId === id) {
        set({
          currentAgent: null,
          loading: false,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }
  },

  createAgent: async (config) => {
    try {
      const result = await agentApi.create(config)
      if (result.success) {
        await get().refreshAgents()
        get().setCurrentAgentId(result.id)
      }
      return result.id
    } catch {
      return ''
    }
  },

  updateAgent: async (id, config) => {
    await agentApi.update(id, config)
    await Promise.all([
      get().refreshAgents(),
      get().currentAgentId === id ? get().fetchAgent(id) : Promise.resolve()
    ])
  },

  deleteAgent: async (id) => {
    await agentApi.delete(id)
    const isCurrentAgent = get().currentAgentId === id
    if (isCurrentAgent) {
      set({ currentAgentId: null, currentAgent: null, loading: false, error: null })
    }
    await get().refreshAgents()
  }
}))
