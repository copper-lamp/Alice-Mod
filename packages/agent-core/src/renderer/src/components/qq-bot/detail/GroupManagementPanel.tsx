import React, { useState } from 'react'
import { useQQBotStore } from '../../../stores/qqBotStore'
import { GroupList } from './GroupList'
import { GroupMemberList } from './GroupMemberList'

interface GroupManagementPanelProps {
  accountId: string
}

type ViewState =
  | { type: 'list' }
  | { type: 'members'; groupId: string; groupName: string }

export const GroupManagementPanel: React.FC<GroupManagementPanelProps> = ({ accountId }) => {
  const accounts = useQQBotStore(s => s.accounts)
  const account = accounts.find(a => a.id === accountId)
  const [view, setView] = useState<ViewState>({ type: 'list' })

  const handleSelectGroup = (groupId: string, groupName: string) => {
    setView({ type: 'members', groupId, groupName })
  }

  const handleBack = () => {
    setView({ type: 'list' })
  }

  // 检查账号是否在线
  if (!account) {
    return (
      <div className="flex items-center justify-center h-32 text-xs text-gray-400">
        账号不存在
      </div>
    )
  }

  if (account.status !== 'online') {
    return (
      <div className="flex flex-col items-center justify-center h-32 gap-2">
        <div className="text-xs text-gray-400">账号未在线，无法获取群信息</div>
        <div className="text-[10px] text-gray-300">
          当前状态：{account.status === 'reconnecting' ? '连接中' : account.status === 'error' ? '错误' : '离线'}
        </div>
      </div>
    )
  }

  return (
    <div className="h-full">
      {view.type === 'list' ? (
        <GroupList
          accountId={accountId}
          onSelectGroup={handleSelectGroup}
        />
      ) : (
        <GroupMemberList
          accountId={accountId}
          groupId={view.groupId}
          groupName={view.groupName}
          onBack={handleBack}
        />
      )}
    </div>
  )
}