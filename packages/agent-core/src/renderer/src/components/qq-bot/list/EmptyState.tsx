import React from 'react'
import { Button } from '@heroui/react'
import { useQQBotStore } from '../../../stores/qqBotStore'

export const EmptyState: React.FC = () => {
  const startAddAccount = useQQBotStore(s => s.startAddAccount)
  const isConfiguring = useQQBotStore(s => s.isConfiguring)

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-5 text-center p-6">
      <div className="w-20 h-20 rounded-full bg-gray-100 flex items-center justify-center">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-gray-400">
          <rect x="3" y="11" width="18" height="10" rx="2" />
          <circle cx="12" cy="5" r="2" />
          <path d="M12 7v4" />
          <line x1="8" y1="16" x2="8" y2="16" />
          <line x1="16" y1="16" x2="16" y2="16" />
        </svg>
      </div>

      <div>
        <h2 className="text-base font-medium text-gray-700">你还没有QQ机器人账号</h2>
        <p className="text-sm text-gray-400 mt-1">添加一个账号，开始使用机器人自动回复</p>
      </div>

      <Button
        size="lg"
        className="px-6 py-5 text-base"
        onPress={() => startAddAccount('qr')}
        isPending={isConfiguring}
        isDisabled={isConfiguring}
      >
        {isConfiguring ? '配置中...' : '添加第一个QQ账号'}
      </Button>

      {!isConfiguring && (
        <button
          className="text-sm text-gray-400 hover:text-gray-600 underline cursor-pointer"
          onClick={() => startAddAccount('manual')}
        >
          也可以手动配置
        </button>
      )}

      {isConfiguring && (
        <div className="flex items-center gap-2 text-sm text-blue-600">
          <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
          <span>正在配置中...</span>
        </div>
      )}
    </div>
  )
}
