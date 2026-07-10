import React from 'react'
import type { QQAccount } from '../../../stores/qqBotStore'

interface Props {
  accounts: QQAccount[]
}

export const StatsBar: React.FC<Props> = ({ accounts }) => {
  const online = accounts.filter(a => a.status === 'online' && a.enabled).length
  const todayMessages = accounts.reduce((sum, a) => sum + a.stats.messagesReceived + a.stats.messagesSent, 0)

  return (
    <div className="flex items-center gap-4 text-xs text-gray-500">
      <StatItem value={online} label="在线" dot="bg-green-400" />
      <div className="w-px h-4 bg-gray-200" />
      <StatItem value={todayMessages} label="今日消息" />
    </div>
  )
}

const StatItem: React.FC<{ label: string; value: number; dot?: string }> = ({ label, value, dot }) => (
  <div className="flex items-center gap-1.5">
    {dot && <span className={`w-2 h-2 rounded-full ${dot}`} />}
    <span className="font-semibold text-gray-700">{value}</span>
    <span>{label}</span>
  </div>
)
