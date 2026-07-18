import React, { useRef, useEffect } from 'react'
import { useChatStore } from '../../stores/useChatStore'
import MessageBubble from '../chat/MessageBubble'

interface QQChatPanelProps {
  agentId: string
}

/**
 * QQ 对话日志面板
 *
 * 与 ChatPanel 类似，但仅显示 source === 'qq' 的消息。
 * 使用全局 chatStore 并过滤，避免重复订阅 IPC 流。
 */
const QQChatPanel: React.FC<QQChatPanelProps> = ({ agentId }) => {
  const messages = useChatStore(s => s.messages)
  const bottomRef = useRef<HTMLDivElement>(null)

  const qqMessages = messages.filter(m => m.source === 'qq')

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [qqMessages.length])

  if (qqMessages.length === 0) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center text-gray-400 px-5">
        <div className="text-center">
          <p className="text-base font-medium text-gray-500">QQ 对话日志</p>
          <p className="text-sm mt-1">暂无 QQ 消息记录</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="py-3 px-4">
        {qqMessages.map(msg => (
          <div key={msg.id} className="mb-2">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] text-gray-400">
                {new Date(msg.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
              </span>
              {msg.source === 'qq' && (
                <span className="text-[10px] bg-blue-50 text-blue-500 px-1.5 py-0.5 rounded">QQ</span>
              )}
            </div>
            <MessageBubble message={msg} />
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}

export default QQChatPanel