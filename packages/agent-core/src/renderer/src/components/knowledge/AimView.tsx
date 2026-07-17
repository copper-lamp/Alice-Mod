/**
 * AimView — 目标任务管理 UI（v2.0 新增）
 *
 * 展示主线/支线任务列表，查看任务详情，勾选完成子任务。
 * 任务格式：{type(main/side), title, description, items[{content, done}], progress, status}
 */

import React, { useState, useEffect, useCallback } from 'react'
import { aimApi } from '../../lib/ipc'

interface AimItem {
  id: string
  content: string
  done: boolean
}

interface AimTask {
  id: string
  type: string
  title: string
  description: string
  items: AimItem[]
  progress: number
  status: string
  createdAt: number
  updatedAt: number
}

const AimView: React.FC = () => {
  const [tasks, setTasks] = useState<AimTask[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filterType, setFilterType] = useState('')
  const [filterStatus, setFilterStatus] = useState('active')
  const [selectedTask, setSelectedTask] = useState<AimTask | null>(null)

  const loadTasks = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params: any = {}
      if (filterType) params.type = filterType
      if (filterStatus) params.status = filterStatus
      const result = await aimApi.list(params)
      setTasks(result.tasks ?? [])
    } catch (err) {
      setError(`加载失败: ${(err as Error).message}`)
    } finally {
      setLoading(false)
    }
  }, [filterType, filterStatus])

  useEffect(() => {
    loadTasks()
  }, [loadTasks])

  const handleToggleItem = async (taskId: string, itemId: string, done: boolean) => {
    try {
      await aimApi.update({ id: taskId, item_id: itemId, done: !done })
      const result = await aimApi.get(taskId)
      if (result.task) {
        setTasks(prev => prev.map(t => t.id === taskId ? result.task : t))
        if (selectedTask?.id === taskId) {
          setSelectedTask(result.task)
        }
      }
    } catch (err) {
      setError(`更新失败: ${(err as Error).message}`)
    }
  }

  const getTypeLabel = (type: string) => {
    const map: Record<string, string> = { main: '主线', side: '支线' }
    return map[type] ?? type
  }

  const getTypeBadgeClass = (type: string) => {
    const map: Record<string, string> = { main: 'bg-red-100 text-red-800', side: 'bg-yellow-100 text-yellow-800' }
    return map[type] ?? 'bg-gray-100 text-gray-800'
  }

  const getStatusBadgeClass = (status: string) => {
    const map: Record<string, string> = { active: 'bg-blue-100 text-blue-800', completed: 'bg-green-100 text-green-800', abandoned: 'bg-gray-100 text-gray-800' }
    return map[status] ?? 'bg-gray-100 text-gray-800'
  }

  const progressBarColor = (progress: number) => {
    if (progress >= 100) return 'bg-green-500'
    if (progress >= 50) return 'bg-blue-500'
    return 'bg-yellow-500'
  }

  return (
    <div className="flex flex-col gap-4">
      {/* 工具栏 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500">类型：</span>
          <select
            className="border rounded px-2 py-1 text-sm"
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
          >
            <option value="">全部</option>
            <option value="main">主线</option>
            <option value="side">支线</option>
          </select>
          <span className="text-sm text-gray-500 ml-2">状态：</span>
          <select
            className="border rounded px-2 py-1 text-sm"
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
          >
            <option value="active">进行中</option>
            <option value="completed">已完成</option>
            <option value="">全部</option>
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

      {/* 任务列表 */}
      {loading ? (
        <div className="text-center py-8 text-gray-400">加载中...</div>
      ) : tasks.length === 0 ? (
        <div className="text-center py-8 text-gray-400">暂无任务</div>
      ) : (
        <div className="space-y-3">
          {tasks.map(task => (
            <div
              key={task.id}
              className="border rounded-lg p-4 hover:shadow-sm transition-shadow"
            >
              {/* 任务标题行 */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${getTypeBadgeClass(task.type)}`}>
                    {getTypeLabel(task.type)}
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${getStatusBadgeClass(task.status)}`}>
                    {task.status === 'active' ? '进行中' : task.status === 'completed' ? '已完成' : '已放弃'}
                  </span>
                  <span
                    className="font-medium cursor-pointer"
                    onClick={() => setSelectedTask(selectedTask?.id === task.id ? null : task)}
                  >
                    {task.title}
                  </span>
                </div>
                <span className="text-sm text-gray-500">{task.progress}%</span>
              </div>

              {/* 进度条 */}
              <div className="w-full bg-gray-200 rounded-full h-2 mb-2">
                <div
                  className={`h-2 rounded-full transition-all ${progressBarColor(task.progress)}`}
                  style={{ width: `${task.progress}%` }}
                />
              </div>

              {/* 任务描述 */}
              <div className="text-sm text-gray-600 mb-2">{task.description}</div>

              {/* 子任务列表 */}
              {selectedTask?.id === task.id && task.items.length > 0 && (
                <div className="border-t pt-2 mt-2 space-y-1">
                  {task.items.map(item => (
                    <div
                      key={item.id}
                      className="flex items-center gap-2 py-1 cursor-pointer hover:bg-gray-50 rounded px-1"
                      onClick={() => handleToggleItem(task.id, item.id, item.done)}
                    >
                      <input
                        type="checkbox"
                        checked={item.done}
                        onChange={() => {}} // handled by onClick
                        className="cursor-pointer"
                      />
                      <span className={`text-sm ${item.done ? 'line-through text-gray-400' : 'text-gray-700'}`}>
                        {item.content}
                      </span>
                    </div>
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

export default AimView