import React from 'react'
import { useChat } from '../../hooks/useChat'
import MessageList from './MessageList'

/** 对话面板 - 监控日志视图（仅含运行信息 + 强制停止按钮） */
const ChatPanel: React.FC = () => {
  const {
    messages,
    isStreaming,
    streamingEvents,
    error,
    stopStream
  } = useChat()

  return (
    <div className="flex flex-col flex-1 overflow-hidden relative">
      {/* 错误提示 */}
      {error && (
        <div className="px-4 py-2 bg-red-50 border-b border-red-100 text-xs text-red-500 shrink-0">
          {error}
        </div>
      )}

      {/* 消息列表 */}
      <MessageList
        messages={messages}
        isStreaming={isStreaming}
        streamingEvents={streamingEvents}
      />

      {/* 强制停止按钮 - 右下角 */}
      {isStreaming && (
        <div className="absolute bottom-4 right-4 z-10">
          <button
            onClick={stopStream}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-red-500 hover:bg-red-600 rounded-lg shadow-sm transition-colors"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
              <rect x="4" y="4" width="16" height="16" rx="2" />
            </svg>
            强制停止
          </button>
        </div>
      )}
    </div>
  )
}

export default ChatPanel