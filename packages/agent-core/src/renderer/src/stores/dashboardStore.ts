import { create } from 'zustand'
import type { DashboardStats, DailyUsage, ActivityData } from '../lib/types'

const defaultStats: DashboardStats = {
  todayTokens: 0,
  monthTokens: 0,
  totalTokens: 0,
  activeConnections: 0,
  totalAgents: 0,
  onlineAgents: 0,
  providerDistribution: [],
  topModels: []
}

interface DashboardState {
  stats: DashboardStats
  dailyUsage: DailyUsage[]
  activityData: ActivityData[]
  loading: boolean

  fetchStats: () => Promise<void>
  fetchUsageHistory: (days: number) => Promise<void>
  fetchActivity: () => Promise<void>
}

export const useDashboardStore = create<DashboardState>((set) => ({
  stats: defaultStats,
  dailyUsage: [],
  activityData: [],
  loading: false,

  fetchStats: async () => {
    set({ loading: true })
    try {
      const stats = await window.electronAPI.invoke('dashboard:stats') as DashboardStats
      set({ stats, loading: false })
    } catch {
      set({ loading: false })
    }
  },

  fetchUsageHistory: async (days) => {
    try {
      const data = await window.electronAPI.invoke('dashboard:usage-history', { days }) as DailyUsage[]
      set({ dailyUsage: data })
    } catch {
      // ignore
    }
  },

  fetchActivity: async () => {
    try {
      const data = await window.electronAPI.invoke('dashboard:agent-activity') as ActivityData[]
      set({ activityData: data })
    } catch {
      // ignore
    }
  }
}))