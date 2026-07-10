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
        return (
          <div key={activeNav} className="flex-1 flex items-center justify-center bg-white rounded-xl shadow-sm border border-gray-200 animate-fadeIn">
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