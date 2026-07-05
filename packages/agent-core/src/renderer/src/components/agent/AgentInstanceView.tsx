import React, { useEffect } from 'react'
import { Tabs } from '@heroui/react'
import { useUIStore } from '../../stores/uiStore'
import { useAgentStore } from '../../stores/agentStore'
import ChatPanel from '../chat/ChatPanel'
import AgentConfigForm from './AgentConfigForm'

const AgentInstanceView: React.FC = () => {
  const { agentViewTab, setAgentViewTab } = useUIStore()
  const { currentAgent, fetchAgent, agents, currentAgentId } = useAgentStore()

  useEffect(() => {
    if (currentAgentId && !currentAgent) {
      fetchAgent(currentAgentId)
    }
  }, [currentAgentId])

  // 从 agents 列表中找到当前智能体的概要信息（用于获取状态）
  const currentSummary = agents.find(a => a.id === currentAgentId)

  if (!currentAgentId || !currentSummary) {
    return (
      <div className="flex-1 flex items-center justify-center bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="text-center">
          <div className="text-4xl mb-3 text-gray-300">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mx-auto">
              <rect x="3" y="11" width="18" height="10" rx="2" />
              <circle cx="12" cy="5" r="2" />
              <path d="M12 7v4" />
              <line x1="8" y1="16" x2="8" y2="16" />
              <line x1="16" y1="16" x2="16" y2="16" />
            </svg>
          </div>
          <p className="text-sm text-gray-400">未选择智能体</p>
          <p className="text-xs text-gray-400 mt-1">请从左侧列表选择一个智能体查看</p>
        </div>
      </div>
    )
  }

  const statusColor = {
    online: 'bg-green-400',
    connecting: 'bg-yellow-400',
    offline: 'bg-gray-300'
  }[currentSummary.status] ?? 'bg-gray-300'

  return (
    <div className="flex-1 flex flex-col bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
      {/* 标题栏：左侧头像/名字/时间，右侧 tabs */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 shrink-0">
        <div className="flex items-center gap-3">
          {currentAgent?.skinData && (
            <img src={currentAgent.skinData} alt="头像" className="w-8 h-8 rounded-full object-cover" />
          )}
          <span className={`w-2.5 h-2.5 rounded-full ${statusColor}`} />
          <span className="text-base font-semibold text-gray-800">{currentSummary.name}</span>
          <span className="text-xs text-gray-400">
            最后运行: {currentSummary.lastActiveAt
              ? new Date(currentSummary.lastActiveAt).toLocaleString('zh-CN')
              : '从未运行'}
          </span>
        </div>

        <Tabs
          selectedKey={agentViewTab}
          onSelectionChange={(key) => setAgentViewTab(key as 'info' | 'config')}
          className="shrink-0"
        >
          <Tabs.ListContainer>
            <Tabs.List aria-label="智能体视图">
              <Tabs.Tab id="info">
                信息
                <Tabs.Indicator />
              </Tabs.Tab>
              <Tabs.Tab id="config">
                配置
                <Tabs.Indicator />
              </Tabs.Tab>
            </Tabs.List>
          </Tabs.ListContainer>
        </Tabs>
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-hidden">
        {agentViewTab === 'info' ? (
          <ChatPanel />
        ) : (
          <div className="h-full p-5">
            <AgentConfigForm agentId={currentAgentId} />
          </div>
        )}
      </div>
    </div>
  )
}

export default AgentInstanceView
