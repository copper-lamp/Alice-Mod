import React from 'react'
import { Button } from '@heroui/react'
import { useQQBotStore } from '../../../stores/qqBotStore'
import type { QQAccount } from '../../../stores/qqBotStore'
import { StatsBar } from './StatsBar'
import { AccountCard } from './AccountCard'

export const AccountListView: React.FC = () => {
  const accounts = useQQBotStore(s => s.accounts)
  const accountOrder = useQQBotStore(s => s.accountOrder)
  const selectedAccountId = useQQBotStore(s => s.selectedAccountId)
  const startAddAccount = useQQBotStore(s => s.startAddAccount)
  const toggleAccount = useQQBotStore(s => s.toggleAccount)
  const selectAccount = useQQBotStore(s => s.selectAccount)
  const isConfiguring = useQQBotStore(s => s.isConfiguring)

  const sortedAccounts = React.useMemo(() => {
    const map = new Map(accounts.map((a: QQAccount) => [a.id, a]))
    return accountOrder.map((id: string) => map.get(id)).filter(Boolean) as QQAccount[]
  }, [accounts, accountOrder])

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="shrink-0 px-4 pt-4 pb-2">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-700">QQ 机器人</h2>
          <span className="text-xs text-gray-400">{accounts.length} 个账号</span>
        </div>
        <StatsBar accounts={accounts} />
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-1">
        {sortedAccounts.map((account: QQAccount) => (
          <AccountCard
            key={account.id}
            account={account}
            selected={account.id === selectedAccountId}
            onToggle={toggleAccount}
            onClick={selectAccount}
          />
        ))}

        {isConfiguring && (
          <div className="flex items-center gap-3 p-3 rounded-lg bg-blue-50 border border-blue-100 text-sm text-blue-600">
            <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
            <span>正在配置中...</span>
          </div>
        )}
      </div>

      <div className="shrink-0 p-3 border-t border-gray-100">
        <Button
          className="w-full"
          variant="secondary"
          size="sm"
          onPress={() => startAddAccount('qr')}
          isPending={isConfiguring}
          isDisabled={isConfiguring}
        >
          {isConfiguring ? '配置中...' : '添加账号'}
        </Button>
      </div>
    </div>
  )
}