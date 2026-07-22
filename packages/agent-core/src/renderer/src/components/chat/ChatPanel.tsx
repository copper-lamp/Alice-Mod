import React, { useEffect, useState, useCallback, useRef } from 'react'
import { useAgentStore } from '../../stores/agentStore'
import { chatApi } from '../../lib/ipc'
import type { ChatMessage } from '../../lib/types'
import MessageList from './MessageList'

/**
 * 智能体对话日志面板
 *
 * 从后端加载当前智能体的 LLM 对话历史（chat:history），
 * 支持实时轮询更新（每 5 秒检查新消息）和加载更多。
 */
const ChatPanel: React.FC = () => {
  const currentAgent = useAgentStore(s => s.currentAgent)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [limit, setLimit] = useState(50)
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastMessageIdRef = useRef<string>('')

  const workspaceId = currentAgent?.workspaceId ?? ''
  const agentId = currentAgent?.id

  // 加载对话历史
  const loadHistory = useCallback(async (showLoading = true) => {
    if (!agentId) {
      setLoading(false)
      return
    }
    if (showLoading) setLoading(true)
    try {
      const data = await chatApi.history(workspaceId, limit, agentId)
      setMessages(data)
      if (data.length > 0) {
        lastMessageIdRef.current = data[data.length - 1].id
      }
    } catch (err) {
      console.error('[ChatPanel] 加载历史失败:', err)
      if (showLoading) setMessages([])
    } finally {
      if (showLoading) setLoading(false)
    }
  }, [workspaceId, agentId, limit])

  // 轮询增量更新
  const pollNewMessages = useCallback(async () => {
    if (!agentId) return
    try {
      const data = await chatApi.history(workspaceId, 50)
      if (data.length > 0) {
        const lastId = data[data.length - 1].id
        if (lastId !== lastMessageIdRef.current) {
          loadHistory(false)
        }
      }
    } catch {
      // 静默处理轮询错误
    }
  }, [workspaceId, agentId, loadHistory])

  // 初始加载 + 定时轮询
  useEffect(() => {
    loadHistory()

    // 每 5 秒轮询新消息
    pollingRef.current = setInterval(pollNewMessages, 5000)

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current)
        pollingRef.current = null
      }
    }
  }, [loadHistory, pollNewMessages])

  // 加载更多
  const handleLoadMore = () => {
    setLimit(prev => prev + 50)
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* 顶部操作栏 */}
      <div className="shrink-0 px-4 py-2 border-b border-gray-100 bg-white flex items-center justify-end gap-2">
        <button
          onClick={() => loadHistory()}
          disabled={loading}
          className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-gray-500 bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
          {loading ? '加载中...' : '刷新'}
        </button>
      </div>

      {/* 消息列表 */}
      {loading && messages.length === 0 ? (
        <div className="flex-1 min-h-0 flex items-center justify-center py-12 text-sm text-gray-400">
          加载中...
        </div>
      ) : messages.length === 0 ? (
        <div className="flex-1 min-h-0 flex items-center justify-center text-gray-400 px-5 py-16">
          <div className="text-center">
            <p className="text-base font-medium text-gray-500">LLM 对话面板</p>
            <p className="text-sm mt-1">等待玩家通过游戏或 QQ 发起对话</p>
          </div>
        </div>
      ) : (
        <MessageList
          messages={messages}
          isStreaming={false}
          streamingEvents={[]}
        />
      )}

      {/* 加载更多 */}
      {messages.length > 0 && (
        <div className="shrink-0 py-2 text-center">
          <button
            className="text-xs text-gray-400 hover:text-gray-600 cursor-pointer"
            onClick={handleLoadMore}
          >
            加载更多
          </button>
        </div>
      )}
    </div>
  )
}

export default ChatPanel