import { create } from 'zustand'
import type {
  LayoutMode,
  NavPanelType,
  AgentViewTab,
  PendingAgentNavigation
} from '../lib/types'
import { useAgentStore } from './agentStore'

interface UIState {
  layoutMode: LayoutMode
  activeNav: NavPanelType
  agentViewTab: AgentViewTab
  hasUnsavedAgentSettings: boolean
  pendingAgentNavigation: PendingAgentNavigation | null

  setLayoutMode: (mode: LayoutMode) => void
  setActiveNav: (nav: NavPanelType) => void
  setAgentViewTab: (tab: AgentViewTab) => void
  setHasUnsavedAgentSettings: (hasUnsavedChanges: boolean) => void
  cancelPendingAgentNavigation: () => void
  proceedPendingAgentNavigation: () => void
  navigateToAgent: (agentId: string) => void
  navigateToCreate: () => void
}

export const useUIStore = create<UIState>((set, get) => ({
  layoutMode: 'nav-view',
  activeNav: 'dashboard',
  agentViewTab: 'runtime',
  hasUnsavedAgentSettings: false,
  pendingAgentNavigation: null,

  setLayoutMode: (mode) => {
    if (get().hasUnsavedAgentSettings && mode !== 'agent-view') {
      set({ pendingAgentNavigation: { type: 'layout', layoutMode: mode } })
      return
    }
    set({ layoutMode: mode })
  },

  setActiveNav: (nav) => set({ activeNav: nav }),

  setAgentViewTab: (tab) => {
    if (get().hasUnsavedAgentSettings && get().agentViewTab === 'settings' && tab !== 'settings') {
      set({ pendingAgentNavigation: { type: 'tab', tab } })
      return
    }
    set({ agentViewTab: tab })
  },

  setHasUnsavedAgentSettings: (hasUnsavedChanges) => set({
    hasUnsavedAgentSettings: hasUnsavedChanges
  }),

  cancelPendingAgentNavigation: () => set({ pendingAgentNavigation: null }),

  proceedPendingAgentNavigation: () => {
    const target = get().pendingAgentNavigation
    if (!target) return

    set({
      hasUnsavedAgentSettings: false,
      pendingAgentNavigation: null,
      ...(target.type === 'tab' ? { agentViewTab: target.tab } : {}),
      ...(target.type === 'layout' ? { layoutMode: target.layoutMode } : {}),
      ...(target.type === 'agent' ? { layoutMode: 'agent-view' as const, agentViewTab: 'runtime' as const } : {})
    })

    if (target.type === 'agent') {
      useAgentStore.getState().setCurrentAgentId(target.agentId)
    }
  },

  navigateToAgent: (agentId) => {
    if (get().hasUnsavedAgentSettings) {
      set({ pendingAgentNavigation: { type: 'agent', agentId } })
      return
    }
    set({
      layoutMode: 'agent-view',
      agentViewTab: 'runtime'
    })
    useAgentStore.getState().setCurrentAgentId(agentId)
  },

  navigateToCreate: () => get().setLayoutMode('agent-create')
}))
