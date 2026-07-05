import React from 'react'
import type { ToolCallInfo } from '../../lib/types'

/** 单个工具调用卡片 */
const ToolCallCard: React.FC<{ call: ToolCallInfo }> = ({ call }) => {
  const statusIcon = {
    pending: <span className="w-3 h-3 rounded-full border-2 border-gray-300" />,
    running: <span className="w-3 h-3 rounded-full bg-yellow-400 animate-pulse" />,
    success: (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="3">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    ),
    error: (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="3">
        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    )
  }

  const statusLabel = { pending: '等待中', running: '执行中', success: '成功', error: '失败' }

  return (
    <div className="flex items-start gap-2 py-1.5 px-2 bg-gray-50 rounded-md border border-gray-100 text-xs">
      <span className="mt-0.5 flex-shrink-0">{statusIcon[call.status]}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-gray-700">{call.name}</span>
          <span className="text-gray-400">({call.category})</span>
          <span className="text-gray-400 ml-auto">{statusLabel[call.status]}</span>
          {call.result?.duration_ms != null && (
            <span className="text-gray-400">{call.result.duration_ms}ms</span>
          )}
        </div>
        {call.status === 'success' && call.result && (
          <pre className="mt-0.5 text-gray-500 truncate">
            {JSON.stringify(call.result.data)}
          </pre>
        )}
      </div>
    </div>
  )
}

export default ToolCallCard