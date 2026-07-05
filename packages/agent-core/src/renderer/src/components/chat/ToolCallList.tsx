import React from 'react'
import type { ToolCallInfo } from '../../lib/types'
import ToolCallCard from './ToolCallCard'

/** 工具调用列表 */
const ToolCallList: React.FC<{ calls: ToolCallInfo[] }> = ({ calls }) => {
  if (!calls || calls.length === 0) return null

  const successCount = calls.filter(c => c.status === 'success').length

  return (
    <div className="mb-2">
      <div className="flex items-center gap-1.5 mb-1">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
        </svg>
        <span className="text-xs text-gray-500">
          工具调用 ({successCount}/{calls.length})
        </span>
      </div>
      <div className="space-y-1">
        {calls.map(call => (
          <ToolCallCard key={call.id} call={call} />
        ))}
      </div>
    </div>
  )
}

export default ToolCallList