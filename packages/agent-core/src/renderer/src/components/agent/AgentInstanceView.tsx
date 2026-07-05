import React, { useEffect } from 'react'
import { Tabs } from '@heroui/react'
import { useUIStore } from '../../stores/uiStore'
import { useAgentStore } from '../../stores/agentStore'
import ChatPanel from '../chat/ChatPanel'
import AgentConfigForm from './AgentConfigForm'

function formatTime(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return '刚刚'
  if (diffMin < 60) return `${diffMin} 分钟前`
  const diffHour = Math.floor(diffMin / 60)
  if (diffHour < 24) return `${diffHour} 小时前`
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

const AgentInstanceView: React.FC = () => {
  const { agentViewTab, setAgentViewTab } = useUIStore()
  const { currentAgent, fetchAgent, agents, currentAgentId } = useAgentStore()

  useEffect(() => {
    if (currentAgentId && !currentAgent) {
      fetchAgent(currentAgentId)
    }
  }, [currentAgentId])

  // 从 agents 列表中找到当前智能体的概要信息
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

  return (
    <div className="flex-1 flex flex-col bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
      {/* 标题栏 - 上栏：头像、名字、最后运行时间、Tabs */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 shrink-0">
        <div className="flex items-center gap-3">
          {/* 头像 */}
          <div className="w-8 h-8 rounded-full bg-gray-100 overflow-hidden flex items-center justify-center border border-gray-200">
            {(currentSummary.skinData || currentAgent?.skinData) ? (
              <img
                src={currentSummary.skinData || currentAgent?.skinData}
                alt="头像"
                className="w-full h-full object-cover"
              />
            ) : (
              <span className="text-sm font-medium text-gray-500">
                {currentSummary.name.charAt(0)}
              </span>
            )}
          </div>
          {/* 名字 */}
          <div>
            <span className="text-base font-semibold text-gray-800">{currentSummary.name}</span>
            <span className="text-xs text-gray-400 ml-2 capitalize">{currentSummary.status}</span>
          </div>
          {/* 最后运行时间 */}
          <span className="text-xs text-gray-400 ml-1">
            {currentSummary.lastActiveAt ? `最后活跃: ${formatTime(currentSummary.lastActiveAt)}` : '未运行'}
          </span>
        </div>
        {/* Tabs 在右侧 */}
        <Tabs
          selectedKey={agentViewTab}
          onSelectionChange={(key) => setAgentViewTab(key as 'info' | 'config')}
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

      {/* 内容区 - 下栏 */}
      {agentViewTab === 'info' ? (
        <ChatPanel />
      ) : (
        <AgentConfigForm agentId={currentAgentId} />
      )}
    </div>
  )
}

export default AgentInstanceView