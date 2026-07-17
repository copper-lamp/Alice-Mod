/**
 * AimView — 目标任务管理 UI（v2.0 重构）
 *
 * 表格展示任务列表，支持：
 * - 创建任务（填写标题、描述、类型、子任务列表）
 * - 点击任务展开表格编辑器，可编辑子任务（添加/删除行、勾选完成）
 * - 删除任务
 * 数据通过 aimApi 连接后端。
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
  const [showCreate, setShowCreate] = useState(false)
  const [createForm, setCreateForm] = useState({ type: 'main' as string, title: '', description: '', items: [''] })
  const [saving, setSaving] = useState(false)
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  const notify = useCallback((type: 'success' | 'error', message: string) => {
    setNotification({ type, message })
    setTimeout(() => setNotification(null), 3000)
  }, [])

  const loadTasks = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params: any = {}
      if (filterType) params.type = filterType
      if (filterStatus) params.status = filterStatus
      const result = await aimApi.list(params)
      // 安全处理
      const safe = (result.tasks ?? []).map((t: any) => ({
        id: t.id ?? '',
        type: t.type ?? 'main',
        title: t.title ?? '',
        description: t.description ?? '',
        items: Array.isArray(t.items) ? t.items.map((i: any) => ({ id: i.id ?? '', content: i.content ?? '', done: !!i.done })) : [],
        progress: typeof t.progress === 'number' ? t.progress : 0,
        status: t.status ?? 'active',
        createdAt: t.createdAt ?? Date.now(),
        updatedAt: t.updatedAt ?? Date.now(),
      }))
      setTasks(safe)
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
      const result = await aimApi.update({ id: taskId, item_id: itemId, done: !done })
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

  const handleDelete = async (id: string) => {
    if (!window.confirm('确定删除此任务？')) return
    try {
      const result = await aimApi.delete(id)
      if (result.success) {
        if (selectedTask?.id === id) setSelectedTask(null)
        await loadTasks()
      } else {
        notify('error', result.error || '删除失败')
      }
    } catch (err) {
      notify('error', `删除失败: ${(err as Error).message}`)
    }
  }

  const handleCreate = async () => {
    if (!createForm.title.trim()) {
      notify('error', '请输入任务标题')
      return
    }
    const validItems = createForm.items.filter(i => i.trim())
    if (validItems.length === 0) {
      notify('error', '请至少添加一个子任务')
      return
    }
    setSaving(true)
    try {
      const result = await aimApi.create({
        type: createForm.type,
        title: createForm.title.trim(),
        description: createForm.description.trim(),
        items: validItems.map(i => i.trim()),
      })
      if (result.task) {
        notify('success', '任务创建成功')
        setShowCreate(false)
        setCreateForm({ type: 'main', title: '', description: '', items: [''] })
        await loadTasks()
      } else {
        notify('error', result.error || '创建失败')
      }
    } catch (err) {
      notify('error', `创建失败: ${(err as Error).message}`)
    } finally {
      setSaving(false)
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
      {/* 通知 */}
      {notification && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-2 rounded-lg shadow-lg text-sm ${
          notification.type === 'success' ? 'bg-green-100 text-green-800 border border-green-200' : 'bg-red-100 text-red-800 border border-red-200'
        }`}>
          {notification.message}
        </div>
      )}

      {/* 工具栏 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500">类型：</span>
          <select className="border rounded px-2 py-1 text-sm" value={filterType} onChange={e => setFilterType(e.target.value)}>
            <option value="">全部</option>
            <option value="main">主线</option>
            <option value="side">支线</option>
          </select>
          <span className="text-sm text-gray-500 ml-2">状态：</span>
          <select className="border rounded px-2 py-1 text-sm" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
            <option value="active">进行中</option>
            <option value="completed">已完成</option>
            <option value="">全部</option>
          </select>
        </div>
        <button className="bg-blue-500 text-white text-sm px-3 py-1.5 rounded-lg hover:bg-blue-600" onClick={() => setShowCreate(true)}>
          + 新建任务
        </button>
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
            <div key={task.id} className="border rounded-lg p-4 hover:shadow-sm transition-shadow">
              {/* 任务标题行 */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${getTypeBadgeClass(task.type)}`}>{getTypeLabel(task.type)}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${getStatusBadgeClass(task.status)}`}>
                    {task.status === 'active' ? '进行中' : task.status === 'completed' ? '已完成' : '已放弃'}
                  </span>
                  <span
                    className="font-medium cursor-pointer text-sm"
                    onClick={() => setSelectedTask(selectedTask?.id === task.id ? null : task)}
                  >
                    {task.title}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-500">{task.progress}%</span>
                  <button className="text-xs text-red-500 hover:text-red-700" onClick={() => handleDelete(task.id)}>删除</button>
                </div>
              </div>

              {/* 进度条 */}
              <div className="w-full bg-gray-200 rounded-full h-2 mb-2">
                <div className={`h-2 rounded-full transition-all ${progressBarColor(task.progress)}`} style={{ width: `${task.progress}%` }} />
              </div>

              {/* 任务描述 */}
              <div className="text-sm text-gray-600 mb-2">{task.description}</div>

              {/* 表格编辑器 - 展开时显示 */}
              {selectedTask?.id === task.id && (
                <div className="border-t pt-3 mt-2">
                  <div className="text-xs text-gray-400 mb-2">子任务表格编辑器（点击勾选切换完成状态）</div>
                  <table className="w-full text-sm border rounded-lg overflow-hidden">
                    <thead>
                      <tr className="bg-gray-50 text-gray-500 text-xs">
                        <th className="text-left px-3 py-2 font-medium w-10">状态</th>
                        <th className="text-left px-3 py-2 font-medium">子任务内容</th>
                      </tr>
                    </thead>
                    <tbody>
                      {task.items.map(item => (
                        <tr key={item.id} className="border-t hover:bg-gray-50 cursor-pointer" onClick={() => handleToggleItem(task.id, item.id, item.done)}>
                          <td className="px-3 py-2">
                            <input type="checkbox" checked={item.done} onChange={() => {}} className="cursor-pointer" />
                          </td>
                          <td className={`px-3 py-2 ${item.done ? 'line-through text-gray-400' : 'text-gray-700'}`}>
                            {item.content}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 新建任务弹窗 */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowCreate(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[85vh] overflow-y-auto mx-4" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-gray-100">
              <h3 className="text-base font-semibold text-gray-700">新建任务</h3>
            </div>
            <div className="px-6 py-4 space-y-4">
              {/* 类型 */}
              <div>
                <label className="block text-sm text-gray-500 mb-1">任务类型</label>
                <select className="w-full border rounded px-3 py-1.5 text-sm" value={createForm.type} onChange={e => setCreateForm({ ...createForm, type: e.target.value })}>
                  <option value="main">主线任务</option>
                  <option value="side">支线任务</option>
                </select>
              </div>
              {/* 标题 */}
              <div>
                <label className="block text-sm text-gray-500 mb-1">任务标题 *</label>
                <input type="text" className="w-full px-3 py-1.5 text-sm border rounded-lg focus:outline-none focus:border-blue-300"
                  value={createForm.title} onChange={e => setCreateForm({ ...createForm, title: e.target.value })} placeholder="例如：建造铁砧" />
              </div>
              {/* 描述 */}
              <div>
                <label className="block text-sm text-gray-500 mb-1">任务描述</label>
                <textarea className="w-full h-16 p-2 text-sm border rounded-lg resize-none focus:outline-none focus:border-blue-300"
                  value={createForm.description} onChange={e => setCreateForm({ ...createForm, description: e.target.value })} placeholder="描述任务目标..." />
              </div>
              {/* 子任务列表 */}
              <div>
                <label className="block text-sm text-gray-500 mb-1">子任务列表（每行一项）</label>
                <div className="space-y-1">
                  {createForm.items.map((item, idx) => (
                    <div key={idx} className="flex items-center gap-1">
                      <input type="text" className="flex-1 px-3 py-1.5 text-sm border rounded-lg focus:outline-none focus:border-blue-300"
                        value={item} onChange={e => {
                          const newItems = [...createForm.items]
                          newItems[idx] = e.target.value
                          setCreateForm({ ...createForm, items: newItems })
                        }} placeholder={`子任务 ${idx + 1}`} />
                      {createForm.items.length > 1 && (
                        <button className="text-red-400 hover:text-red-600 text-sm" onClick={() => {
                          setCreateForm({ ...createForm, items: createForm.items.filter((_, i) => i !== idx) })
                        }}>×</button>
                      )}
                    </div>
                  ))}
                </div>
                <button className="text-xs text-blue-500 hover:text-blue-700 mt-1" onClick={() => {
                  setCreateForm({ ...createForm, items: [...createForm.items, ''] })
                }}>+ 添加子任务</button>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2">
              <button className="px-4 py-1.5 text-sm border rounded-lg hover:bg-gray-50" onClick={() => setShowCreate(false)}>取消</button>
              <button className="px-4 py-1.5 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50" disabled={saving} onClick={handleCreate}>
                {saving ? '创建中...' : '创建任务'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default AimView