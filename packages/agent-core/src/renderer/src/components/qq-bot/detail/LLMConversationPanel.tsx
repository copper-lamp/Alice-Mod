import React, { useEffect, useState, useCallback } from 'react'
import { Select, Button, ListBox } from '@heroui/react'
import { chatApi } from '../../../lib/ipc'
import type { ChatMessage } from '../../../lib/types'
import MessageList from '../../chat/MessageList'

interface Props {
  workspaceId: string
  agentId: string
}

/** 来源筛选类型 */
type SourceFilter = 'all' | 'qq' | 'game' | 'system'

export const LLMConversationPanel: React.FC<Props> = ({ workspaceId, agentId }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all')
  const [limit, setLimit] = useState(30)

  const loadHistory = useCallback(async () => {
    if (!workspaceId || !agentId) return
    setLoading(true)
    try {
      const data = await chatApi.qqHistory(workspaceId, agentId, limit)
      // 前端过滤
      const filtered = sourceFilter === 'all'
        ? data
        : data.filter(m => m.source === sourceFilter)
      setMessages(filtered)
    } catch {
      setMessages([])
    } finally {
      setLoading(false)
    }
  }, [workspaceId, agentId, limit, sourceFilter])

  useEffect(() => {
    loadHistory()
  }, [loadHistory])

  const handleLoadMore = () => {
    setLimit(prev => prev + 30)
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* 过滤栏 */}
      <div className="flex items-center gap-2 pb-3 shrink-0">
        <Select
          selectedKey={sourceFilter}
          onSelectionChange={(key) => { if (key) setSourceFilter(key as SourceFilter) }}
          className="w-28"
        >
          <Select.Trigger>
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              <ListBox.Item id="all" textValue="全部">全部来源</ListBox.Item>
              <ListBox.Item id="qq" textValue="QQ">QQ</ListBox.Item>
              <ListBox.Item id="game" textValue="游戏">游戏</ListBox.Item>
              <ListBox.Item id="system" textValue="系统">系统</ListBox.Item>
            </ListBox>
          </Select.Popover>
        </Select>

        <Button
          size="sm"
          variant="secondary"
          onPress={loadHistory}
        >
          {loading ? '加载中...' : '刷新'}
        </Button>
      </div>

      {/* 对话流 */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {loading && messages.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-sm text-gray-400">
            加载中...
          </div>
        ) : messages.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-sm text-gray-400">
            暂无 LLM 对话记录
          </div>
        ) : (
          <MessageList
            messages={messages}
            isStreaming={false}
            streamingEvents={[]}
          />
        )}
      </div>

      {/* 加载更多 */}
      {messages.length > 0 && (
        <div className="pt-2 text-center shrink-0">
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