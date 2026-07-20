import React, { useEffect, useState } from 'react'
import { Tabs, Card } from '@heroui/react'
import { useQQBotStore } from '../../../stores/qqBotStore'
import { DetailHeader } from './DetailHeader'
import { PermissionPanel } from './PermissionPanel'
import { BridgeConfigPanel } from './BridgeConfigPanel'
import { MessageLogPanel } from './MessageLogPanel'
import { GroupManagementPanel } from './GroupManagementPanel'
import { LLMConversationPanel } from './LLMConversationPanel'

interface AgentBinding {
  workspaceId: string
  agentId: string
}

export const AccountDetailView: React.FC = () => {
  const selectedAccountId = useQQBotStore(s => s.selectedAccountId)
  const accounts = useQQBotStore(s => s.accounts)
  const selectedAccount = accounts.find((a: { id: string }) => a.id === selectedAccountId)

  const [agentBinding, setAgentBinding] = useState<AgentBinding | null>(null)

  useEffect(() => {
    if (!selectedAccountId) {
      setAgentBinding(null)
      return
    }
    // 加载 LLM 对话历史所需的 agent 绑定信息
    window.electronAPI.invoke('qq-bot:get-agent-binding', selectedAccountId)
      .then((binding: unknown) => {
        setAgentBinding(binding as AgentBinding | null)
      })
      .catch(() => setAgentBinding(null))
  }, [selectedAccountId])

  if (!selectedAccount) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-gray-400 p-6">
        <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mb-4">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <rect x="3" y="11" width="18" height="10" rx="2" />
            <circle cx="12" cy="5" r="2" />
            <path d="M12 7v4" />
          </svg>
        </div>
        <p className="text-sm">选择左侧账号以查看详情</p>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <DetailHeader account={selectedAccount} />

      <div className="flex-1 overflow-hidden px-4 pb-4">
        <Tabs aria-label="账号配置" className="h-full flex flex-col">
          <Tabs.List className="shrink-0">
            <Tabs.Tab id="permission">权限管理</Tabs.Tab>
            <Tabs.Tab id="bridge">桥接配置</Tabs.Tab>
            <Tabs.Tab id="logs">消息日志</Tabs.Tab>
            <Tabs.Tab id="groups">群聊管理</Tabs.Tab>
            <Tabs.Tab id="llm">LLM 对话</Tabs.Tab>
          </Tabs.List>
          <div className="flex-1 overflow-hidden pt-3 min-h-0">
            <Tabs.Panel id="permission" className="h-full">
              <Card className="p-4 h-full overflow-y-auto">
                <PermissionPanel account={selectedAccount} />
              </Card>
            </Tabs.Panel>
            <Tabs.Panel id="bridge" className="h-full">
              <Card className="p-4 h-full overflow-y-auto">
                <BridgeConfigPanel account={selectedAccount} />
              </Card>
            </Tabs.Panel>
            <Tabs.Panel id="logs" className="h-full">
              <Card className="p-4 h-full overflow-hidden">
                <MessageLogPanel />
              </Card>
            </Tabs.Panel>
            <Tabs.Panel id="groups" className="h-full">
              <Card className="p-4 h-full overflow-hidden">
                <GroupManagementPanel accountId={selectedAccount.id} />
              </Card>
            </Tabs.Panel>
            <Tabs.Panel id="llm" className="h-full">
              <Card className="p-4 h-full overflow-hidden">
                {agentBinding ? (
                  <LLMConversationPanel
                    workspaceId={agentBinding.workspaceId}
                    agentId={agentBinding.agentId}
                  />
                ) : (
                  <div className="flex items-center justify-center py-12 text-sm text-gray-400">
                    该账号未绑定 Agent，无法查看 LLM 对话历史
                  </div>
                )}
              </Card>
            </Tabs.Panel>
          </div>
        </Tabs>
      </div>
    </div>
  )
}