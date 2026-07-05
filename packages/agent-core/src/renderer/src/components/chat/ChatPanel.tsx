import React from 'react'
import { useChat } from '../../hooks/useChat'
import MessageList from './MessageList'

/** 对话面板 - 仅消息流和强制停止按钮 */
const ChatPanel: React.FC = () => {
  const {
    messages,
    isStreaming,
    streamingEvents,
    error,
    stopStreaming
  } = useChat()

  return (
    <div className="flex flex-col h-full relative">
      {/* 错误提示 */}
      {error && (
        <div className="px-3 py-2 bg-red-50 border-b border-red-100 text-xs text-red-500 shrink-0">
          {error}
        </div>
      )}

      {/* 消息列表 */}
      <div className="flex-1 overflow-hidden">
        <MessageList
          messages={messages}
          isStreaming={isStreaming}
          streamingEvents={streamingEvents}
        />
      </div>

      {/* 右下角强制停止按钮 */}
      {isStreaming && (
        <div className="absolute bottom-4 right-4">
          <button
            onClick={stopStreaming}
            className="flex items-center gap-1.5 px-4 py-2 bg-red-500 hover:bg-red-600 text-white text-xs font-medium rounded-lg shadow-lg transition-colors"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="6" width="12" height="12" rx="2" />
            </svg>
            强制停止
          </button>
        </div>
      )}
    </div>
  )
}

export default ChatPanel