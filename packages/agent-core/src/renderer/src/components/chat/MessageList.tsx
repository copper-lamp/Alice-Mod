import React, { useRef, useEffect } from 'react'
import type { ChatMessage } from '../../lib/types'
import type { StreamEvent } from '../../stores/chatStore'
import MessageBubble from './MessageBubble'
import ThinkingBlock from './ThinkingBlock'
import ToolCallBlock from './ToolCallBlock'

interface Props {
  messages: ChatMessage[]
  isStreaming: boolean
  streamingEvents: StreamEvent[]
  autoFollow?: boolean
  onAutoFollowChange?: (enabled: boolean) => void
  header?: React.ReactNode
  emptyTitle?: string
  emptyDescription?: string
}

/** 消息列表 - 按有序事件渲染 */
const MessageList: React.FC<Props> = ({
  messages,
  isStreaming,
  streamingEvents = [],
  autoFollow = true,
  onAutoFollowChange,
  header,
  emptyTitle = 'LLM 对话面板',
  emptyDescription = '等待玩家通过游戏或 QQ 发起对话',
}) => {
  const bottomRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (autoFollow) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingEvents, autoFollow])

  const handleScroll = () => {
    const element = scrollRef.current
    if (!element || !autoFollow) return
    if (element.scrollHeight - element.scrollTop - element.clientHeight > 48) {
      onAutoFollowChange?.(false)
    }
  }

  if (messages.length === 0 && !isStreaming) {
    return (
      <div className="flex-1 min-h-0 overflow-y-auto flex items-center justify-center px-5 text-muted">
        <div className="text-center">
          <p className="text-base font-medium text-foreground">{emptyTitle}</p>
          <p className="text-sm mt-1 text-muted">{emptyDescription}</p>
        </div>
      </div>
    )
  }

  return (
    <div ref={scrollRef} onScroll={handleScroll} className="flex-1 min-h-0 overflow-y-auto">
      <div className="py-3 px-4">
        {header}
        {messages.map(msg => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {/* 流式输出 - 按事件顺序渲染 */}
        {isStreaming && (
          <div className="mb-4">
            <p className="mb-1 text-[10px] text-muted">
              {new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
            </p>

            {streamingEvents.map((evt, i) => {
              if (evt.type === 'thinking') {
                return <ThinkingBlock key={i} content={evt.data as string} />
              }
              if (evt.type === 'tool_calls') {
                const calls = evt.data as any
                if (!calls || calls.length === 0) return null
                return (
                  <div key={i} className="mb-2">
                    {calls.map((call: any, idx: number) => (
                      <ToolCallBlock key={`${call.id || idx}`} call={call} />
                    ))}
                  </div>
                )
              }
              if (evt.type === 'text') {
                const text = evt.data as string
                const isLast = i === streamingEvents.length - 1
                return text ? (
                  <p key={i} className="mb-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">
                    {text}
                    {isLast && (
                      <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-foreground align-text-bottom" />
                    )}
                  </p>
                ) : null
              }
              return null
            })}
          </div>
        )}

        <div ref={bottomRef} />
      </div>
    </div>
  )
}

export default MessageList
