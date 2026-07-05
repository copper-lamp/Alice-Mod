import { create } from 'zustand'

export type KnowledgeTab = 'database' | 'map-index' | 'expert' | 'experience' | 'agent-memory'

interface KnowledgeState {
  activeTab: KnowledgeTab
  setActiveTab: (tab: KnowledgeTab) => void
}

export const useKnowledgeStore = create<KnowledgeState>((set) => ({
  activeTab: 'database',

  setActiveTab: (tab) => set({ activeTab: tab })
}))