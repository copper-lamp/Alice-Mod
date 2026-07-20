import React, { useState } from 'react'
import type { ToolCallInfo } from '../../lib/types'

/** 单个工具调用卡片 — 可展开查看完整返回内容 */
const ToolCallCard: React.FC<{ call: ToolCallInfo }> = ({ call }) => {
  const [expanded, setExpanded] = useState(false)

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

  const hasResult = call.result !== undefined
  const resultData = call.result?.data
  const resultStr = resultData !== undefined ? JSON.stringify(resultData, null, 2) : ''
  const resultError = call.result?.error
  const contentLength = resultStr.length

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

        {/* 参数摘要 */}
        {call.params && Object.keys(call.params).length > 0 && (
          <div className="mt-0.5 text-gray-400 truncate">
            {Object.entries(call.params).map(([k, v]) => {
              const val = typeof v === 'object' ? JSON.stringify(v) : String(v)
              return `${k}=${val.length > 40 ? val.slice(0, 40) + '...' : val}`
            }).join(', ')}
          </div>
        )}

        {/* 结果展开/折叠 */}
        {hasResult && (
          <div className="mt-1">
            <button
              onClick={() => setExpanded(!expanded)}
              className="flex items-center gap-1 text-blue-500 hover:text-blue-700 transition-colors"
            >
              <svg
                width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                className={`transition-transform ${expanded ? 'rotate-90' : ''}`}
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
              <span className="text-[11px]">
                {expanded ? '收起返回内容' : `查看返回内容${contentLength > 0 ? ` (${contentLength}字符)` : ''}`}
              </span>
            </button>

            {expanded && (
              <div className="mt-1 p-2 bg-white rounded border border-gray-200">
                <pre className="text-[11px] text-gray-600 whitespace-pre-wrap break-words max-h-60 overflow-y-auto leading-relaxed">
                  {resultStr || (call.result?.success ? '成功' : String(call.result?.data ?? ''))}
                </pre>
                {resultError && (
                  <div className="mt-1 text-red-500 text-[11px]">
                    错误: {resultError}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default ToolCallCard