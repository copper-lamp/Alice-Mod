import React from 'react'
import { TextField, Input, Select, Button, ListBox } from '@heroui/react'
import { useQQBotStore } from '../../../stores/qqBotStore'
import type { LogEntry } from '../../../stores/qqBotStore'

const LogFilterBar: React.FC = () => {
  const logFilter = useQQBotStore(s => s.logFilter)
  const setLogFilter = useQQBotStore(s => s.setLogFilter)
  const selectedAccountId = useQQBotStore(s => s.selectedAccountId)
  const clearLogs = useQQBotStore(s => s.clearLogs)

  return (
    <div className="flex items-center gap-2 pb-3 shrink-0">
      <Select
        selectedKey={logFilter.type}
        onSelectionChange={(key) => { if (key) setLogFilter({ type: key as LogEntry['type'] | 'all' }) }}
        className="w-28"
      >
        <Select.Trigger>
          <Select.Value />
          <Select.Indicator />
        </Select.Trigger>
        <Select.Popover>
          <ListBox>
            <ListBox.Item id="all" textValue="全部">全部</ListBox.Item>
            <ListBox.Item id="group" textValue="群聊">群聊</ListBox.Item>
            <ListBox.Item id="private" textValue="私聊">私聊</ListBox.Item>
            <ListBox.Item id="system" textValue="系统">系统</ListBox.Item>
          </ListBox>
        </Select.Popover>
      </Select>

      <TextField value={logFilter.search} onChange={(v) => setLogFilter({ search: v })} className="flex-1">
        <Input placeholder="搜索消息内容..." />
      </TextField>

      <Button
        size="sm"
        variant="secondary"
        onPress={() => selectedAccountId && clearLogs(selectedAccountId)}
      >
        清空
      </Button>
    </div>
  )
}

const MessageLogItem: React.FC<{ entry: LogEntry }> = ({ entry }) => {
  const isIncoming = entry.direction === 'incoming'
  const time = new Date(entry.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })

  const typeColors: Record<string, string> = {
    group: 'text-blue-500',
    private: 'text-purple-500',
    system: 'text-gray-500',
  }

  return (
    <div className={`flex gap-3 py-2 ${isIncoming ? '' : 'bg-gray-50/50'} rounded px-2`}>
      <div className="shrink-0 pt-0.5">
        {isIncoming ? (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-green-500">
            <line x1="22" y1="12" x2="2" y2="12" />
            <polyline points="8 18 2 12 8 6" />
          </svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-blue-500">
            <line x1="2" y1="12" x2="22" y2="12" />
            <polyline points="16 6 22 12 16 18" />
          </svg>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={`text-xs font-medium ${typeColors[entry.type] ?? 'text-gray-500'}`}>
            {entry.type === 'group' ? '群聊' : entry.type === 'private' ? '私聊' : '系统'}
          </span>
          <span className="text-xs text-gray-400">{entry.userName}</span>
          {entry.groupId && (
            <span className="text-xs text-gray-400">#{entry.groupId}</span>
          )}
          <span className="text-xs text-gray-300 ml-auto">{time}</span>
        </div>
        <p className="text-sm text-gray-700 mt-0.5 break-words">{entry.content}</p>
        {entry.reply && (
          <div className="mt-0.5 text-xs text-gray-400 bg-gray-100 rounded px-2 py-1 inline-block">
            → {entry.reply}
          </div>
        )}
        {entry.duration !== undefined && (
          <span className="text-xs text-gray-300 ml-1">({entry.duration}ms)</span>
        )}
      </div>
    </div>
  )
}

export const MessageLogPanel: React.FC = () => {
  const messageLogs = useQQBotStore(s => s.messageLogs)
  const selectedAccountId = useQQBotStore(s => s.selectedAccountId)
  const loadMoreLogs = useQQBotStore(s => s.loadMoreLogs)

  return (
    <div className="flex flex-col h-full min-h-0">
      <LogFilterBar />

      <div className="flex-1 overflow-y-auto space-y-0.5 min-h-0">
        {messageLogs.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-sm text-gray-400">
            暂无消息记录
          </div>
        ) : (
          messageLogs.map((entry: LogEntry) => (
            <MessageLogItem key={entry.id} entry={entry} />
          ))
        )}
      </div>

      {messageLogs.length > 0 && (
        <div className="pt-2 text-center shrink-0">
          <button
            className="text-xs text-gray-400 hover:text-gray-600 cursor-pointer"
            onClick={() => selectedAccountId && loadMoreLogs(selectedAccountId)}
          >
            加载更多
          </button>
        </div>
      )}
    </div>
  )
}
