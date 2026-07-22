import React, { useState } from 'react'
import type { ToolCallInfo } from '../../lib/types'

/** 工具调用状态图标 */
const StatusIcon: React.FC<{ status: ToolCallInfo['status'] }> = ({ status }) => {
  if (status === 'pending') {
    return <span className="w-2.5 h-2.5 rounded-full border-2 border-gray-300" />
  }
  if (status === 'running') {
    return <span className="w-2.5 h-2.5 rounded-full bg-yellow-400 animate-pulse" />
  }
  if (status === 'success') {
    return (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="3">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    )
  }
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="3">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}

const statusLabel = { pending: '等待中', running: '执行中', success: '成功', error: '失败' }

/** 工具调用展示块 - 折叠时一行纯文本，展开后淡卡片包裹输入与返回 */
const ToolCallBlock: React.FC<{ call: ToolCallInfo }> = ({ call }) => {
  const [expanded, setExpanded] = useState(false)

  const hasResult = call.result !== undefined
  const resultData = call.result?.data
  const resultStr = resultData !== undefined ? JSON.stringify(resultData, null, 2) : ''
  const resultError = call.result?.error
  const contentLength = resultStr.length

  // 参数摘要（一行）
  const paramSummary = React.useMemo(() => {
    if (!call.params || Object.keys(call.params).length === 0) return ''
    return Object.entries(call.params).map(([k, v]) => {
      const val = typeof v === 'object' ? JSON.stringify(v) : String(v)
      return `${k}=${val.length > 30 ? val.slice(0, 30) + '...' : val}`
    }).join(', ')
  }, [call.params])

  return (
    <div className="mb-1.5">
      {/* 折叠态：一行 icon + 纯文本 */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="group flex items-center gap-1.5 w-full text-left"
      >
        <span className="mt-0.5 flex-shrink-0 text-gray-400 group-hover:text-gray-600 transition-colors">
          <StatusIcon status={call.status} />
        </span>
        <span className="text-xs text-gray-500 group-hover:text-gray-700 transition-colors">
          <span className="font-medium">{call.name}</span>
          {paramSummary && <span className="text-gray-400 ml-1.5">({paramSummary})</span>}
          <span className="text-gray-300 ml-2">{statusLabel[call.status]}</span>
          {call.result?.duration_ms != null && (
            <span className="text-gray-300 ml-1.5">{call.result.duration_ms}ms</span>
          )}
        </span>
        <svg
          width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          className={`ml-auto text-gray-300 transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`}
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>

      {/* 展开态：淡卡片包裹输入与返回 */}
      {expanded && (
        <div className="mt-1.5 ml-4 p-2.5 bg-gray-50/80 rounded-md border border-gray-100/80 text-xs">
          {/* 输入参数 */}
          {call.params && Object.keys(call.params).length > 0 && (
            <div className="mb-2">
              <div className="text-[10px] text-gray-400 mb-1">输入</div>
              <pre className="text-[11px] text-gray-600 whitespace-pre-wrap break-words leading-relaxed">
                {JSON.stringify(call.params, null, 2)}
              </pre>
            </div>
          )}

          {/* 返回结果 */}
          {hasResult && (
            <div>
              <div className="flex items-center gap-2 text-[10px] text-gray-400 mb-1">
                <span>返回</span>
                <span className={call.result?.success ? 'text-green-500' : 'text-red-500'}>
                  {call.result?.success ? '成功' : '失败'}
                </span>
                {call.result?.duration_ms != null && (
                  <span>{call.result.duration_ms}ms</span>
                )}
              </div>
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
  )
}

export default ToolCallBlock
