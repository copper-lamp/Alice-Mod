import React from 'react'
import { Switch } from '@heroui/react'
import { useQQBotStore } from '../../../stores/qqBotStore'
import type { QQAccount } from '../../../stores/qqBotStore'

const STATUS_CONFIG: Record<string, { dot: string; text: string }> = {
  online: { dot: 'bg-green-400', text: '在线' },
  reconnecting: { dot: 'bg-yellow-400', text: '重连中' },
  offline: { dot: 'bg-gray-300', text: '离线' },
  error: { dot: 'bg-red-400', text: '错误' },
}

interface Props {
  account: QQAccount
}

export const DetailHeader: React.FC<Props> = ({ account }) => {
  const toggleAccount = useQQBotStore(s => s.toggleAccount)
  const config = STATUS_CONFIG[account.status] ?? STATUS_CONFIG.offline

  return (
    <div className="flex items-center gap-3 px-4 py-4 border-b border-gray-100 shrink-0">
      <div className="flex items-center justify-center w-10 h-10 rounded-full bg-gray-100 shrink-0">
        <span className={`w-3 h-3 rounded-full ${account.enabled ? config.dot : 'bg-gray-300'}`} />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-mono text-base font-medium text-gray-800">{account.qqNumber || '未设置'}</span>
          {account.nickname && (
            <span className="text-sm text-gray-500 truncate">({account.nickname})</span>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-gray-400 mt-0.5">
          <span>{account.enabled ? config.text : '已停用'}</span>
          <span>·</span>
          <span>{account.stats.groupsCount} 个群</span>
          <span>·</span>
          <span>收 {account.stats.messagesReceived} / 发 {account.stats.messagesSent}</span>
        </div>
      </div>

      <Switch isSelected={account.enabled} onChange={(v: boolean) => toggleAccount(account.id, v)}>
        <Switch.Content>
          <Switch.Control>
            <Switch.Thumb />
          </Switch.Control>
        </Switch.Content>
      </Switch>
    </div>
  )
}
