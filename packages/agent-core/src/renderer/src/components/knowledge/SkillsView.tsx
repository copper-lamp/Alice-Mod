/**
 * SkillsView — 技能管理 UI（v2.1 重构：表格+开关）
 *
 * v2.1 变更：
 * - 从列表改为表格布局，每行包含技能名称、描述、阶段、启用开关
 * - 开关按钮可逐个启用/禁用技能
 * - 保留新建/编辑/删除功能
 *
 * 数据通过 memoryApi 连接后端（存储为 type='skill' 的记忆）。
 * 技能内容的 content.enabled 字段控制是否启用（默认 true）。
 */

import React, { useState, useEffect, useCallback } from 'react'
import { Switch } from '@heroui/react'
import { memoryApi } from '../../lib/ipc'

interface SkillItem {
  id: string
  name: string
  description: string
  content: string
  enabled: boolean
  createdAt: number
  updatedAt: number
}

const SkillsView: React.FC = () => {
  const [skills, setSkills] = useState<SkillItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showEditor, setShowEditor] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', description: '', content: '' })
  const [saving, setSaving] = useState(false)
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  const notify = useCallback((type: 'success' | 'error', message: string) => {
    setNotification({ type, message })
    setTimeout(() => setNotification(null), 3000)
  }, [])

  const loadSkills = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await memoryApi.list({ type: 'skill', limit: 100 })
      const mapped: SkillItem[] = (result.memories ?? []).map((m: any) => {
        const c = (m.content as Record<string, unknown>) ?? {}
        return {
          id: m.id ?? '',
          name: (c.name as string) ?? '',
          description: (c.description as string) ?? '',
          content: (c.text as string) ?? '',
          enabled: (c.enabled as boolean) ?? true,
          createdAt: m.createdAt ?? Date.now(),
          updatedAt: m.updatedAt ?? Date.now(),
        }
      })
      setSkills(mapped)
    } catch (err) {
      setError(`加载失败: ${(err as Error).message}`)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadSkills()
  }, [loadSkills])

  const openCreate = () => {
    setEditingId(null)
    setForm({ name: '', description: '', content: '' })
    setShowEditor(true)
  }

  const openEdit = (skill: SkillItem) => {
    setEditingId(skill.id)
    setForm({ name: skill.name, description: skill.description, content: skill.content })
    setShowEditor(true)
  }

  const handleSave = async () => {
    if (!form.name.trim()) {
      notify('error', '请输入技能名称')
      return
    }
    setSaving(true)
    try {
      if (editingId) {
        // 更新时保留现有的 enabled 状态
        const existing = skills.find(s => s.id === editingId)
        const result = await memoryApi.update(editingId, {
          content: {
            name: form.name.trim(),
            description: form.description.trim(),
            text: form.content,
            enabled: existing?.enabled ?? true,
          },
        } as Record<string, unknown>)
        if (result.success) {
          notify('success', '技能更新成功')
        } else {
          notify('error', result.error || '更新失败')
        }
      } else {
        const result = await memoryApi.store({
          type: 'skill',
          branch: 'knowledge',
          content: {
            name: form.name.trim(),
            description: form.description.trim(),
            text: form.content,
            enabled: true,
          },
          tags: [form.name.trim()],
          importance: 5,
        })
        if (result.success) {
          notify('success', '技能创建成功')
        } else {
          notify('error', result.error || '创建失败')
        }
      }
      setShowEditor(false)
      await loadSkills()
    } catch (err) {
      notify('error', `操作失败: ${(err as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!window.confirm('确定删除此技能？')) return
    try {
      const result = await memoryApi.forget(id)
      if (result.success) {
        notify('success', '技能删除成功')
        await loadSkills()
      } else {
        notify('error', result.error || '删除失败')
      }
    } catch (err) {
      notify('error', `删除失败: ${(err as Error).message}`)
    }
  }

  /** 切换技能的启用/禁用状态 */
  const toggleEnabled = async (skill: SkillItem) => {
    const newEnabled = !skill.enabled
    try {
      const result = await memoryApi.update(skill.id, {
        content: {
          name: skill.name,
          description: skill.description,
          text: skill.content,
          enabled: newEnabled,
        },
      } as Record<string, unknown>)
      if (result.success) {
        setSkills(prev => prev.map(s => s.id === skill.id ? { ...s, enabled: newEnabled } : s))
        notify('success', `${skill.name} 已${newEnabled ? '启用' : '禁用'}`)
      } else {
        notify('error', result.error || '更新失败')
      }
    } catch (err) {
      notify('error', `更新失败: ${(err as Error).message}`)
    }
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

      {/* 标题栏 */}
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-700">技能管理</h2>
        <button className="bg-blue-500 text-white text-sm px-3 py-1.5 rounded-lg hover:bg-blue-600" onClick={openCreate}>
          + 新建技能
        </button>
      </div>

      {/* 说明 */}
      <div className="text-xs text-gray-400 bg-gray-50 rounded-lg px-3 py-2">
        通过开关启用/禁用技能。启用的技能将注入到智能体的系统提示词中。
        如需个别智能体单独配置，请在智能体配置页的"技能配置"中覆盖。
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded text-sm">
          {error}
          <button className="ml-2 underline" onClick={() => setError(null)}>关闭</button>
        </div>
      )}

      {/* 技能表格 */}
      {loading ? (
        <div className="text-center py-8 text-gray-400">加载中...</div>
      ) : skills.length === 0 ? (
        <div className="text-center py-8 text-gray-400">暂无技能，点击"新建技能"开始</div>
      ) : (
        <div className="overflow-x-auto border border-gray-200 rounded-lg">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 w-16">启用</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">名称</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">描述</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-gray-500 w-28">操作</th>
              </tr>
            </thead>
            <tbody>
              {skills.map((skill, idx) => (
                <tr key={skill.id} className={`border-b border-gray-100 hover:bg-gray-50 ${idx % 2 === 1 ? 'bg-gray-50/50' : ''}`}>
                  <td className="px-4 py-3">
                    <Switch
                      isSelected={skill.enabled}
                      onChange={() => toggleEnabled(skill)}
                    >
                      <Switch.Content>
                        <Switch.Control>
                          <Switch.Thumb />
                        </Switch.Control>
                      </Switch.Content>
                    </Switch>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-800">{skill.name}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-gray-500 truncate max-w-xs">{skill.description || '-'}</div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        className="text-xs text-blue-500 hover:text-blue-700"
                        onClick={() => openEdit(skill)}
                      >
                        编辑
                      </button>
                      <button
                        className="text-xs text-red-500 hover:text-red-700"
                        onClick={() => handleDelete(skill.id)}
                      >
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 新建/编辑弹窗 */}
      {showEditor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => { setShowEditor(false) }}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[85vh] overflow-y-auto mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-gray-100">
              <h3 className="text-base font-semibold text-gray-700">{editingId ? '编辑技能' : '新建技能'}</h3>
            </div>
            <div className="px-6 py-4 space-y-4">
              <div>
                <label className="block text-sm text-gray-500 mb-1">技能名称 *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                  placeholder="例如：快速砍树"
                  className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-blue-300"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-500 mb-1">描述</label>
                <input
                  type="text"
                  value={form.description}
                  onChange={e => setForm({ ...form, description: e.target.value })}
                  placeholder="技能简短描述"
                  className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-blue-300"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-500 mb-1">内容（skill 标准，纯文本）</label>
                <textarea
                  className="w-full h-48 p-3 text-sm font-mono border border-gray-200 rounded-lg resize-none focus:outline-none focus:border-blue-300"
                  value={form.content}
                  onChange={e => setForm({ ...form, content: e.target.value })}
                  placeholder="技能内容，Agent 加载时使用..."
                />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2">
              <button className="px-4 py-1.5 text-sm border rounded-lg hover:bg-gray-50" onClick={() => setShowEditor(false)}>取消</button>
              <button
                className="px-4 py-1.5 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50"
                disabled={saving}
                onClick={handleSave}
              >
                {saving ? '保存中...' : (editingId ? '保存修改' : '创建')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default SkillsView