import React, { useEffect } from 'react'
import { Toast } from '@heroui/react'
import AppLayout from './components/layout/AppLayout'
import DashboardPanel from './components/dashboard/DashboardPanel'
import ModelPanel from './components/model/ModelPanel'
import KnowledgePanel from './components/knowledge/KnowledgePanel'
import { RobotPage } from './components/qq-bot'
import AgentInstanceView from './components/agent/AgentInstanceView'
import AgentCreatePage from './components/agent/AgentCreatePage'
import ConfigPanel from './components/settings/ConfigPanel'
import { useUIStore } from './stores/uiStore'
import { useWorkspaceStore } from './stores/workspaceStore'

const App: React.FC = () => {
  const { layoutMode, activeNav } = useUIStore()
  const refreshWorkspaces = useWorkspaceStore(s => s.refreshWorkspaces)
  const handleStateChange = useWorkspaceStore(s => s.handleStateChange)

  useEffect(() => {
    // 启动时加载工作区列表
    refreshWorkspaces()

    // 仅在 Electron 环境下注册 IPC 事件监听
    if (!window.electronAPI) return

    // 监听工作区状态变化
    const unsubscribeState = window.electronAPI.on('workspace:state-changed', (event) => {
      handleStateChange(event as { id: string; state: string })
    })

    // 创建/删除后刷新列表
    const unsubscribeCreated = window.electronAPI.on('workspace:created', () => {
      refreshWorkspaces()
    })
    const unsubscribeRemoved = window.electronAPI.on('workspace:removed', () => {
      refreshWorkspaces()
    })

    return () => {
      unsubscribeState()
      unsubscribeCreated()
      unsubscribeRemoved()
    }
  }, [refreshWorkspaces, handleStateChange])

  const renderContent = () => {
    switch (layoutMode) {
      case 'nav-view':
        return <div key={layoutMode} className="flex-1 flex flex-col overflow-hidden">{renderNavContent()}</div>
      case 'agent-view':
        return <AgentInstanceView key={layoutMode} />
      case 'agent-create':
        return <AgentCreatePage key={layoutMode} />
      default:
        return null
    }
  }

  const renderNavContent = () => {
    switch (activeNav) {
      case 'dashboard':
        return <DashboardPanel key={activeNav} />
      case 'model':
        return <ModelPanel key={activeNav} />
      case 'knowledge':
        return <KnowledgePanel key={activeNav} />
      case 'robot':
        return <RobotPage key={activeNav} />
      default:
        return null
    }
  }

  return (
    <>
      <Toast.Provider />
      <AppLayout>
        {renderContent()}
      </AppLayout>
      <ConfigPanel />
    </>
  )
}

export default App
