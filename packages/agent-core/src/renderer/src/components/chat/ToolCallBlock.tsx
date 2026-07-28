import React, { useState } from 'react'
import { Button } from '@heroui/react'
import type { ToolCallInfo } from '../../lib/types'

/** 工具调用状态图标 */
const StatusIcon: React.FC<{ status: ToolCallInfo['status'] }> = ({ status }) => {
  if (status === 'pending') {
    return <span className="h-2.5 w-2.5 rounded-full border-2 border-separator" />
  }
  if (status === 'running') {
    return <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-warning" />
  }
  if (status === 'success') {
    return (
      <svg className="text-success" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    )
  }
  return (
    <svg className="text-danger" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
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

  const paramSummary = React.useMemo(() => {
    if (!call.params || Object.keys(call.params).length === 0) return ''
    return Object.entries(call.params).map(([k, v]) => {
      const val = typeof v === 'object' ? JSON.stringify(v) : String(v)
      return `${k}=${val.length > 30 ? val.slice(0, 30) + '...' : val}`
    }).join(', ')
  }, [call.params])

  return (
    <div className="mb-1.5">
      <Button
        size="sm"
        variant="ghost"
        className="h-auto w-full justify-start px-0 py-0 text-left"
        onPress={() => setExpanded(!expanded)}
      >
        <span className="mt-0.5 shrink-0 text-muted"><StatusIcon status={call.status} /></span>
        <span className="text-xs text-muted">
          <span className="font-medium text-foreground">{call.name}</span>
          {paramSummary && <span className="ml-1.5">({paramSummary})</span>}
          <span className="ml-2 text-muted/70">{statusLabel[call.status]}</span>
          {call.result?.duration_ms != null && <span className="ml-1.5 text-muted/70">{call.result.duration_ms}ms</span>}
        </span>
        <svg
          width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          className={`ml-auto text-muted/70 transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`}
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </Button>

      {expanded && (
        <div className="ml-4 mt-1.5 rounded-md bg-surface-secondary/60 p-2.5 text-xs">
          {call.params && Object.keys(call.params).length > 0 && (
            <div className="mb-2">
              <div className="mb-1 text-[10px] text-muted">输入</div>
              <pre className="whitespace-pre-wrap break-words text-[11px] leading-relaxed text-foreground">{JSON.stringify(call.params, null, 2)}</pre>
            </div>
          )}
          {hasResult && (
            <div>
              <div className="mb-1 flex items-center gap-2 text-[10px] text-muted">
                <span>返回</span>
                <span className={call.result?.success ? 'text-success' : 'text-danger'}>{call.result?.success ? '成功' : '失败'}</span>
                {call.result?.duration_ms != null && <span>{call.result.duration_ms}ms</span>}
              </div>
              <pre className="max-h-60 overflow-y-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-foreground">{resultStr || (call.result?.success ? '成功' : String(call.result?.data ?? ''))}</pre>
              {resultError && <div className="mt-1 text-[11px] text-danger">错误: {resultError}</div>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default ToolCallBlock
