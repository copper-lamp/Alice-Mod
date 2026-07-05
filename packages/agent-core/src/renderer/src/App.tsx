import React from 'react'
import AppLayout from './components/layout/AppLayout'
import DashboardPanel from './components/dashboard/DashboardPanel'
import ModelPanel from './components/model/ModelPanel'
import KnowledgePanel from './components/knowledge/KnowledgePanel'
import AgentInstanceView from './components/agent/AgentInstanceView'
import AgentCreatePage from './components/agent/AgentCreatePage'
import ConfigPanel from './components/settings/ConfigPanel'
import { useUIStore } from './stores/uiStore'

const App: React.FC = () => {
  const { layoutMode, activeNav } = useUIStore()

  const renderContent = () => {
    switch (layoutMode) {
      case 'nav-view':
        return renderNavContent()
      case 'agent-view':
        return <AgentInstanceView />
      case 'agent-create':
        return <AgentCreatePage />
      default:
        return null
    }
  }

  const renderNavContent = () => {
    switch (activeNav) {
      case 'dashboard':
        return <DashboardPanel />
      case 'model':
        return <ModelPanel />
      case 'knowledge':
        return <KnowledgePanel />
      case 'robot':
        return (
          <div className="flex-1 flex items-center justify-center bg-white rounded-lg shadow-sm border border-gray-200">
            <span className="text-sm text-gray-400">机器人模块（V10 实现）</span>
          </div>
        )
      default:
        return null
    }
  }

  return (
    <>
      <AppLayout>
        {renderContent()}
      </AppLayout>
      <ConfigPanel />
    </>
  )
}

export default App