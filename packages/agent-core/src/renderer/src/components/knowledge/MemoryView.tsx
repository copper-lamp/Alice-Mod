/**
 * MemoryView — 记忆浏览器 UI（v2.0 重构）
 *
 * 记忆类型简化为 3 种：event（事件）/character（人物）/experience（经验）
 * content 为纯文本字符串
 *
 * 修复：为 tags/content 添加安全默认值，防止崩溃
 */

import React, { useState, useEffect, useCallback } from 'react'
import { memoryApi } from '../../lib/ipc'

interface MemoryItem {
  id: string
  type: string
  name: string
  content: string
  tags: string[]
  importance: number
  createdAt: number
  updatedAt: number
}

const MEMORY_TYPES = [
  { value: '', label: '全部类型' },
  { value: 'event', label: '事件' },
  { value: 'character', label: '人物' },
  { value: 'experience', label: '经验' },
]

const MemoryView: React.FC = () => {
  const [memories, setMemories] = useState<MemoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filterType, setFilterType] = useState('')
  const [selectedMemory, setSelectedMemory] = useState<MemoryItem | null>(null)

  const loadMemories = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await memoryApi.memoryList({
        type: filterType || undefined,
        limit: 50,
      })
      // 安全处理：确保每个记忆都有 tags 和 content 默认值
      const safe = (result.memories ?? []).map((m: any) => ({
        id: m.id ?? '',
        type: m.type ?? '',
        name: (m.content as any)?.name as string ?? m.name ?? '',
        content: (m.content as any)?.text as string ?? m.content ?? '',
        tags: Array.isArray(m.tags) ? m.tags : [],
        importance: typeof m.importance === 'number' ? m.importance : 5,
        createdAt: m.createdAt ?? Date.now(),
        updatedAt: m.updatedAt ?? Date.now(),
      }))
      setMemories(safe)
    } catch (err) {
      setError(`加载失败: ${(err as Error).message}`)
    } finally {
      setLoading(false)
    }
  }, [filterType])

  useEffect(() => {
    loadMemories()
  }, [loadMemories])

  const handleDelete = async (id: string) => {
    try {
      await memoryApi.memoryEdit({ action: 'delete', id })
      if (selectedMemory?.id === id) setSelectedMemory(null)
      await loadMemories()
    } catch (err) {
      setError(`删除失败: ${(err as Error).message}`)
    }
  }

  const getTypeLabel = (type: string) => {
    const map: Record<string, string> = { event: '事件', character: '人物', experience: '经验' }
    return map[type] ?? type
  }

  const getTypeBadgeClass = (type: string) => {
    const map: Record<string, string> = { event: 'bg-yellow-100 text-yellow-800', character: 'bg-blue-100 text-blue-800', experience: 'bg-green-100 text-green-800' }
    return map[type] ?? 'bg-gray-100 text-gray-800'
  }

  const getImportanceBadgeClass = (imp: number) => {
    if (imp >= 8) return 'bg-red-100 text-red-800'
    if (imp >= 5) return 'bg-yellow-100 text-yellow-800'
    return 'bg-gray-100 text-gray-800'
  }

  return (
    <div className="flex flex-col gap-4">
      {/* 工具栏 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500">类型过滤：</span>
          <select
            className="border rounded px-2 py-1 text-sm"
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
          >
            {MEMORY_TYPES.map(t => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded text-sm">
          {error}
          <button className="ml-2 underline" onClick={() => setError(null)}>关闭</button>
        </div>
      )}

      {/* 记忆列表 */}
      {loading ? (
        <div className="text-center py-8 text-gray-400">加载中...</div>
      ) : memories.length === 0 ? (
        <div className="text-center py-8 text-gray-400">暂无记忆</div>
      ) : (
        <div className="space-y-2">
          {memories.map(m => (
            <div
              key={m.id}
              className="border rounded-lg p-3 hover:shadow-sm transition-shadow cursor-pointer"
              onClick={() => setSelectedMemory(selectedMemory?.id === m.id ? null : m)}
            >
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${getTypeBadgeClass(m.type)}`}>
                    {getTypeLabel(m.type)}
                  </span>
                  <span className="font-medium text-sm">{m.name}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${getImportanceBadgeClass(m.importance)}`}>
                    {m.importance}/10
                  </span>
                </div>
                <button
                  className="text-xs text-red-500 hover:text-red-700"
                  onClick={(e) => { e.stopPropagation(); handleDelete(m.id) }}
                >
                  删除
                </button>
              </div>
              {selectedMemory?.id === m.id && m.content && (
                <div className="mt-2 text-sm text-gray-600 whitespace-pre-wrap">
                  {m.content}
                </div>
              )}
              {m.tags.length > 0 && (
                <div className="flex gap-1 mt-1">
                  {m.tags.map(tag => (
                    <span key={tag} className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default MemoryView