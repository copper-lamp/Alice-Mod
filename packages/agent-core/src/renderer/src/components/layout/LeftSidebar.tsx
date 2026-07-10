import React, { useEffect } from 'react'
import { useUIStore } from '../../stores/uiStore'
import { useAgentStore } from '../../stores/agentStore'
import { useConfigStore } from '../../stores/configStore'

const LeftSidebar: React.FC = () => {
  const { activeNav, setActiveNav, setLayoutMode, navigateToAgent } = useUIStore()
  const { agents, refreshAgents, currentAgentId } = useAgentStore()
  const openConfigPanel = useConfigStore(s => s.openConfigPanel)

  useEffect(() => {
    refreshAgents()
  }, [])

  return (
    <aside className="w-60 flex flex-col bg-gray-100 shrink-0">
      {/* 导航菜单 */}
      <nav className="p-2 pt-4 space-y-0.5">
        {navItems.map(item => (
          <button
            key={item.label}
            onClick={() => {
              setActiveNav(item.nav)
              setLayoutMode('nav-view')
            }}
            className={`w-full flex items-center gap-2.5 px-3 py-1.5 rounded-md text-sm transition-colors ${
              activeNav === item.nav
                ? 'bg-gray-200/70 text-gray-700 font-medium'
                : 'text-gray-500 hover:text-gray-600 hover:bg-gray-200/40'
            }`}
          >
            <item.icon />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      {/* 智能体列表 */}
      <div className="flex-1 p-2">
        <div className="flex items-center justify-between px-3 py-1.5">
          <span className="text-xs text-gray-400 font-medium">智能体</span>
          <button
            onClick={() => setLayoutMode('agent-create')}
            className="text-gray-400 hover:text-gray-500 transition-colors"
            title="创建智能体"
          >
            <PlusIcon />
          </button>
        </div>
        <div className="space-y-0.5">
          {agents.length === 0 ? (
            <div className="px-3 py-2 text-xs text-gray-400">暂无智能体，点击 + 创建</div>
          ) : (
            agents.map(agent => (
              <button
                key={agent.id}
                onClick={() => navigateToAgent(agent.id)}
                className={`w-full flex items-center gap-2.5 px-3 py-1.5 rounded-md text-sm transition-colors ${
                  agent.id === currentAgentId
                    ? 'bg-gray-200/50 text-gray-700'
                    : 'text-gray-500 hover:text-gray-600 hover:bg-gray-200/40'
                }`}
              >
                <StatusDot status={agent.status} />
                <span className="flex-1 text-left truncate">{agent.name}</span>
                <span className="text-[10px] text-gray-400">{agent.toolCount}</span>
              </button>
            ))
          )}
        </div>
      </div>

      {/* 设置 */}
      <div className="p-2">
        <button
          onClick={openConfigPanel}
          className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-md text-sm text-gray-500 hover:text-gray-600 hover:bg-gray-200/40 transition-colors"
        >
          <SettingsIcon />
          <span>设置</span>
        </button>
      </div>
    </aside>
  )
}

const StatusDot: React.FC<{ status: string }> = ({ status }) => {
  const colors: Record<string, string> = {
    online: 'bg-green-400',
    connecting: 'bg-yellow-400',
    offline: 'bg-gray-300'
  }
  return <span className={`w-2 h-2 rounded-full ${colors[status] ?? 'bg-gray-300'}`} />
}

const DashboardIcon: React.FC = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
    <rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
  </svg>
)

const ModelIcon: React.FC = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
  </svg>
)

const KnowledgeIcon: React.FC = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
  </svg>
)

const RobotIcon: React.FC = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <rect x="3" y="11" width="18" height="10" rx="2" />
    <circle cx="12" cy="5" r="2" />
    <path d="M12 7v4" />
    <line x1="8" y1="16" x2="8" y2="16" /><line x1="16" y1="16" x2="16" y2="16" />
  </svg>
)

const PlusIcon: React.FC = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
  </svg>
)

const SettingsIcon: React.FC = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
)

const navItems = [
  { label: '仪表盘', icon: DashboardIcon, nav: 'dashboard' as const },
  { label: '模型', icon: ModelIcon, nav: 'model' as const },
  { label: '知识与技能', icon: KnowledgeIcon, nav: 'knowledge' as const },
  { label: '机器人', icon: RobotIcon, nav: 'robot' as const }
]

export default LeftSidebar