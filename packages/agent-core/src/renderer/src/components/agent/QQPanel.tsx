import React, { useState } from 'react'
import { Tabs } from '@heroui/react'
import QQChatPanel from './QQChatPanel'
import QQConfigForm from './QQConfigForm'

interface QQPanelProps {
  agentId: string
}

type QQSubTab = 'chat' | 'config'

const QQPanel: React.FC<QQPanelProps> = ({ agentId }) => {
  const [subTab, setSubTab] = useState<QQSubTab>('chat')

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* 子 Tab 栏 */}
      <div className="shrink-0 px-5 border-b border-gray-200 bg-white">
        <Tabs
          selectedKey={subTab}
          onSelectionChange={(key) => setSubTab(key as QQSubTab)}
        >
          <Tabs.ListContainer>
            <Tabs.List aria-label="QQ 智能体视图">
              <Tabs.Tab id="chat">
                对话
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
      <div className="flex-1 min-h-0 flex flex-col">
        {subTab === 'chat' ? (
          <QQChatPanel agentId={agentId} />
        ) : (
          <QQConfigForm agentId={agentId} />
        )}
      </div>
    </div>
  )
}

export default QQPanel