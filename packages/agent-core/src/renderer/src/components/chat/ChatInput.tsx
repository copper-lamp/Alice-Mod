import React, { useState, useCallback } from 'react'

interface Props {
  onSend: (text: string) => void
  disabled?: boolean
  placeholder?: string
}

/** 对话输入框 */
const ChatInput: React.FC<Props> = ({ onSend, disabled = false, placeholder = '输入消息...' }) => {
  const [text, setText] = useState('')

  const handleSend = useCallback(() => {
    if (!text.trim() || disabled) return
    onSend(text.trim())
    setText('')
  }, [text, disabled, onSend])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2">
      <input
        type="text"
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        className="flex-1 bg-transparent text-sm text-gray-700 outline-none placeholder:text-gray-400 disabled:opacity-50"
      />
      <button
        onClick={handleSend}
        disabled={disabled || !text.trim()}
        className="text-sm text-blue-500 hover:text-blue-600 font-medium px-2 py-0.5 disabled:text-gray-300 disabled:cursor-not-allowed transition-colors"
      >
        发送
      </button>
    </div>
  )
}

export default ChatInput