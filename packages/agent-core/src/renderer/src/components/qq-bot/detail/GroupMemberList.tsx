import React, { useEffect, useState } from 'react'

interface GroupMemberListProps {
  accountId: string
  groupId: string
  groupName: string
  onBack: () => void
}

interface GroupMember {
  user_id: number
  nickname: string
  card: string
  role: 'owner' | 'admin' | 'member'
}

export const GroupMemberList: React.FC<GroupMemberListProps> = ({ accountId, groupId, groupName, onBack }) => {
  const [members, setMembers] = useState<GroupMember[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadMembers()
  }, [accountId, groupId])

  const loadMembers = async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await window.electronAPI.invoke('qq-bot:get-group-member-list', accountId, groupId) as {
        success: boolean
        members?: GroupMember[]
        error?: string
      }
      if (result.success && result.members) {
        setMembers(result.members)
      } else {
        setError(result.error ?? '获取成员列表失败')
      }
    } catch {
      setError('获取成员列表失败')
    } finally {
      setLoading(false)
    }
  }

  const roleLabel = (role: string): string => {
    switch (role) {
      case 'owner': return '群主'
      case 'admin': return '管理员'
      default: return '成员'
    }
  }

  const roleColor = (role: string): string => {
    switch (role) {
      case 'owner': return 'text-red-500'
      case 'admin': return 'text-blue-500'
      default: return 'text-gray-500'
    }
  }

  return (
    <div className="h-full flex flex-col">
      {/* 头部 */}
      <div className="flex items-center gap-2 mb-3 shrink-0">
        <button
          onClick={onBack}
          className="text-gray-400 hover:text-gray-600 p-1"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <h3 className="text-sm font-medium text-gray-700">{groupName} 成员</h3>
        <span className="text-xs text-gray-400">({members.length} 人)</span>
        <button
          onClick={loadMembers}
          className="ml-auto text-xs text-blue-500 hover:text-blue-700"
        >
          刷新
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
              onClick={loadMembers}
              className="text-xs text-blue-500 hover:text-blue-700"
            >
              重试
            </button>
          </div>
        ) : members.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-xs text-gray-400">
            暂无成员
          </div>
        ) : (
          <div className="space-y-1">
            {members.map(member => (
              <div
                key={member.user_id}
                className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-50"
              >
                <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center text-xs text-blue-600 font-medium shrink-0">
                  {member.nickname.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-gray-700 truncate">
                    {member.card || member.nickname}
                  </div>
                  <div className="text-[10px] text-gray-400">{member.user_id}</div>
                </div>
                <span className={`text-[10px] font-medium shrink-0 ${roleColor(member.role)}`}>
                  {roleLabel(member.role)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}