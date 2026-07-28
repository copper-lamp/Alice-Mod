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
  cancel