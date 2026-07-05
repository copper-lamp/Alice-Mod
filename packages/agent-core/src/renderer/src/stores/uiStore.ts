import { create } from 'zustand'
import type { LayoutMode, NavPanelType, AgentViewTab } from '../lib/types'
import { useAgentStore } from './agentStore'

interface UIState {
  layoutMode: LayoutMode
  activeNav: NavPanelType
  agentViewTab: AgentViewTab
  showRightSidebar: boolean

  setLayoutMode: (mode: LayoutMode) => void
  setActiveNav: (nav: NavPanelType) => void
  setAgentViewTab: (tab: AgentViewTab) => void
  navigateToAgent: (agentId: string) => void
  navigateToCreate: () => void
}

export const useUIStore = create<UIState>((set, get) => ({
  layoutMode: 'nav-view',
  activeNav: 'dashboard',
  agentViewTab: 'info',

  get showRightSidebar() {
    return get().layoutMode === 'agent-view'
  },

  setLayoutMode: (mode) => set({ layoutMode: mode }),

  setActiveNav: (nav) => set({ activeNav: nav }),

  setAgentViewTab: (tab) => set({ agentViewTab: tab }),

  navigateToAgent: (agentId) => {
    set({
      layoutMode: 'agent-view',
      agentViewTab: 'info'
    })
    useAgentStore.getState().setCurrentAgentId(agentId)
  },

  navigateToCreate: () => set({ layoutMode: 'agent-create' })
}))