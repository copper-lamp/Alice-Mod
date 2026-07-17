import { create } from 'zustand'

// v2.0 记忆与学习工具 Tab 类型
export type KnowledgeTab = 'database' | 'memory' | 'maps' | 'skill' | 'aim'

interface KnowledgeState {
  activeTab: KnowledgeTab
  setActiveTab: (tab: KnowledgeTab) => void
}

export const useKnowledgeStore = create<KnowledgeState>((set) => ({
  activeTab: 'database',

  setActiveTab: (tab) => set({ activeTab: tab })
}))