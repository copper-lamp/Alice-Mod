import React from 'react'
import { Card, Switch } from '@heroui/react'
import type { QQAccount } from '../../../stores/qqBotStore'

const STATUS_CONFIG: Record<string, { dot: string; text: string }> = {
  online: { dot: 'bg-green-400', text: '在线' },
  reconnecting: { dot: 'bg-yellow-400', text: '重连中' },
  offline: { dot: 'bg-gray-300', text: '离线' },
  error: { dot: 'bg-red-400', text: '错误' },
}

interface Props {
  account: QQAccount
  selected: boolean
  onToggle: (id: string, enabled: boolean) => void
  onClick: (id: string) => void
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  if (m > 0) return `${m}:${String(s).padStart(2, '0')}`
  return `${s}秒`
}

export const AccountCard: React.FC<Props> = ({ account, selected, onToggle, onClick }) => {
  const config = STATUS_CONFIG[account.status] ?? STATUS_CONFIG.offline
  const isDisabled = !account.enabled

  return (
    <div
      className={`cursor-pointer rounded-lg border transition-colors ${
        selected
          ? 'bg-blue-50 border-blue-200'
          : 'bg-white border-transparent hover:bg-gray-50'
      } ${isDisabled ? 'opacity-50' : ''}`}
      onClick={() => onClick(account.id)}
    >
      <Card className="p-3 bg-transparent border-0 shadow-none">
        <div className="flex items-center gap-3">
          <div className="flex flex-col items-center gap-1 min-w-[40px]">
            <span className={`w-3 h-3 rounded-full ${isDisabled ? 'bg-gray-200' : config.dot}`} />
            <span className="text-[10px] text-gray-500">{isDisabled ? '已停用' : config.text}</span>
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-sm font-medium text-gray-700">{account.qqNumber || '未设置'}</span>
              {account.nickname && (
                <span className="text-xs text-gray-500 truncate">({account.nickname})</span>
              )}
            </div>
            <div className="text-xs text-gray-400 mt-0.5 truncate">
              {account.status === 'online' && account.enabled ? (
                <>
                  {account.stats.groupsCount} 个群 · {formatUptime(account.stats.uptime)}
                </>
              ) : account.error ? (
                <span className="text-red-400">{account.error}</span>
              ) : (
                <>点击管理账号</>
              )}
            </div>
          </div>

          <div onClick={(e) => e.stopPropagation()}>
            <Switch isSelected={account.enabled} onChange={(v: boolean) => onToggle(account.id, v)}>
              <Switch.Content>
                <Switch.Control>
                  <Switch.Thumb />
                </Switch.Control>
              </Switch.Content>
            </Switch>
          </div>
        </div>
      </Card>
    </div>
  )
}
