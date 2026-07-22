import React from 'react'
import type { ChatMessage, ToolCallInfo } from '../../lib/types'
import ThinkingBlock from './ThinkingBlock'
import ToolCallBlock from './ToolCallBlock'

/** 来源标签 */
const SourceTag: React.FC<{ source: ChatMessage['source'] }> = ({ source }) => {
  if (source === 'game') {
    return (
      <span className="inline-flex items-center gap-0.5 text-[10px] text-green-600 font-medium mb-1">
        <GameIcon />
        来自游戏
      </span>
    )
  }
  if (source === 'qq') {
    return (
      <span className="inline-flex items-center gap-0.5 text-[10px] text-blue-600 font-medium mb-1">
        <QQIcon />
        来自 QQ
      </span>
    )
  }
  return null
}

/** 检测是否为工具结果 JSON */
function isToolResultContent(content: string): boolean {
  if (!content || content.length < 3) return false
  try {
    const parsed = JSON.parse(content)
    return parsed && typeof parsed === 'object' && (
      'success' in parsed || 'error' in parsed || 'data' in parsed || 'duration_ms' in parsed
    )
  } catch {
    return false
  }
}

/** 将工具结果消息解析为 ToolCallInfo */
function parseToolResultContent(content: string): ToolCallInfo | null {
  if (!isToolResultContent(content)) return null
  try {
    const parsed = JSON.parse(content)
    return {
      id: parsed.id || 'tool-result',
      name: parsed.toolName || parsed.name || '工具返回',
      category: parsed.category || '',
      params: parsed.params || parsed.arguments || {},
      status: parsed.success === false ? 'error' : 'success',
      result: {
        success: parsed.success !== false,
        data: parsed.data,
        error: parsed.error,
        duration_ms: parsed.duration_ms,
      }
    }
  } catch {
    return null
  }
}

/** 单条消息 */
const MessageBubble: React.FC<{ message: ChatMessage }> = React.memo(({ message }) => {
  const isUser = message.role === 'user'
  const isSystem = message.role === 'system'
  const isTool = message.role === 'tool' || isToolResultContent(message.content)

  // 用户消息 -> 蓝色气泡（右侧）
  if (isUser) {
    return (
      <div className="flex justify-end mb-3">
        <div className="max-w-[75%]">
          <SourceTag source={message.source} />
          <div className="bg-blue-500 text-white rounded-lg rounded-br-sm px-3.5 py-2.5">
            <p className="text-sm whitespace-pre-wrap break-words leading-relaxed">
              {message.content}
            </p>
            <p className="text-[10px] mt-1 text-blue-200">
              {new Date(message.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
            </p>
          </div>
        </div>
      </div>
    )
  }

  // 系统消息 -> 灰色小字居中
  if (isSystem) {
    return (
      <div className="flex justify-center mb-3">
        <div className="bg-gray-100 text-gray-500 text-xs rounded-lg px-3 py-1.5 max-w-[90%]">
          <p className="whitespace-pre-wrap break-words leading-relaxed">{message.content}</p>
        </div>
      </div>
    )
  }

  // 工具结果消息 -> 统一用 ToolCallBlock 展示
  if (isTool) {
    const toolCall = parseToolResultContent(message.content)
    if (!toolCall) {
      return (
        <div className="mb-4">
          <p className="text-[10px] text-gray-400 mb-1">
            {new Date(message.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
          </p>
          <p className="text-sm text-gray-700 whitespace-pre-wrap break-words leading-relaxed">{message.content}</p>
        </div>
      )
    }
    return (
      <div className="mb-4">
        <p className="text-[10px] text-gray-400 mb-1">
          {new Date(message.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
        </p>
        <ToolCallBlock call={toolCall} />
      </div>
    )
  }

  // Agent 消息 -> 纯文本，无卡片框
  return (
    <div className="mb-4">
      <p className="text-[10px] text-gray-400 mb-1">
        {new Date(message.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
      </p>

      {message.thinking && <ThinkingBlock content={message.thinking} />}

      {message.toolCalls && message.toolCalls.length > 0 && (
        <div className="mb-2">
          {message.toolCalls.map(call => (
            <ToolCallBlock key={call.id} call={call} />
          ))}
        </div>
      )}

      {message.content && (
        <p className="text-sm text-gray-700 whitespace-pre-wrap break-words leading-relaxed">
          {message.content}
        </p>
      )}
    </div>
  )
})

MessageBubble.displayName = 'MessageBubble'
export default MessageBubble

/* 图标 */
const GameIcon: React.FC = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
    <path d="M21 6H3a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h18a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1zm-2 6h-3v3h-2v-3h-3v-2h3V7h2v3h3v2z" />
  </svg>
)

const QQIcon: React.FC = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
  </svg>
)
