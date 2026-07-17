import React, { useEffect, useState } from 'react'

interface GroupListProps {
  accountId: string
  onSelectGroup: (groupId: string, groupName: string) => void
}

interface GroupInfo {
  group_id: number
  group_name: string
  member_count: number
  max_member_count: number
}

export const GroupList: React.FC<GroupListProps> = ({ accountId, onSelectGroup }) => {
  const [groups, setGroups] = useState<GroupInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadGroups()
  }, [accountId])

  const loadGroups = async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await window.electronAPI.invoke('qq-bot:get-group-list', accountId) as {
        success: boolean
        groups?: GroupInfo[]
        error?: string
      }
      if (result.success && result.groups) {
        setGroups(result.groups)
      } else {
        setError(result.error ?? '获取群列表失败')
      }
    } catch {
      setError('获取群列表失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="h-full flex flex-col">
      {/* 头部 */}
      <div className="flex items-center justify-between mb-3 shrink-0">
        <h3 className="text-sm font-medium text-gray-700">已加入的群</h3>
        <button
          onClick={loadGroups}
          disabled={loading}
          className="text-xs text-blue-500 hover:text-blue-700 disabled:text-gray-300"
        >
          {loading ? '加载中...' : '刷新'}
        </button>
      </div>

      {/* 内容 */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <div className="text-xs text-gray-400">加载中...</div>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-32 gap-2">
            <div className="text-xs text-red-400">{error}</div>
            <button
              onClick={loadGroups}
              className="text-xs text-blue-500 hover:text-blue-700"
            >
              重试
            </button>
          </div>
        ) : groups.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 gap-2">
            <div className="text-xs text-gray-400">暂无群</div>
            <div className="text-[10px] text-gray-300">请确保机器人已加入群聊</div>
          </div>
        ) : (
          <div className="space-y-1">
            {groups.map(group => (
              <button
                key={group.group_id}
                onClick={() => onSelectGroup(String(group.group_id), group.group_name)}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 text-left transition-colors"
              >
                <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center text-sm text-blue-600 font-medium shrink-0">
                  {group.group_name.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-gray-700 truncate font-medium">
                    {group.group_name}
                  </div>
                  <div className="text-[10px] text-gray-400">
                    {group.group_id} · {group.member_count}/{group.max_member_count} 人
                  </div>
                </div>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-gray-300 shrink-0">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}