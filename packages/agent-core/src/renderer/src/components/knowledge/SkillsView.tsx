/**
 * SkillsView — 技能管理组件
 *
 * 展示和管理 type='skill' 的记忆数据。
 * 支持：列表查看、新建、编辑、删除、搜索过滤。
 */

import React, { useState, useEffect, useCallback } from 'react'
import { Table, Button, Chip, ProgressBar } from '@heroui/react'
import { memoryApi } from '../../lib/ipc'

interface SkillItem {
  id: string
  skillName: string
  description: string
  code?: string
  parameters: string[]
  successRate: number
  usageCount: number
  lastUsed: number
  tags: string[]
  importance: number
  createdAt: number
  updatedAt: number
}

interface CreateSkillForm {
  skillName: string
  description: string
  code: string
  parameters: string
  tags: string
  importance: number
}

const PAGE_SIZE = 20

function parseSkillContent(content: Record<string, unknown>): {
  description: string
  code?: string
  parameters: string[]
  successRate: number
  usageCount: number
  lastUsed: number
} {
  return {
    description: (content.description as string) ?? '',
    code: content.code as string | undefined,
    parameters: Array.isArray(content.parameters) ? content.parameters as string[] : [],
    successRate: (content.successRate as number) ?? 0,
    usageCount: (content.usageCount as number) ?? 0,
    lastUsed: (content.lastUsed as number) ?? 0,
  }
}

function buildSkillContent(skill: {
  description: string
  code?: string
  parameters: string[]
  successRate: number
  usageCount: number
  lastUsed: number
}): Record<string, unknown> {
  return {
    description: skill.description,
    ...(skill.code ? { code: skill.code } : {}),
    parameters: skill.parameters,
    successRate: skill.successRate,
    usageCount: skill.usageCount,
    lastUsed: skill.lastUsed,
  }
}

function formatTime(ts: number): string {
  if (!ts) return '-'
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function getSuccessRateColor(rate: number): 'success' | 'warning' | 'danger' {
  if (rate >= 80) return 'success'
  if (rate >= 50) return 'warning'
  return 'danger'
}

const INITIAL_FORM: CreateSkillForm = {
  skillName: '',
  description: '',
  code: '',
  parameters: '',
  tags: '',
  importance: 5,
}

const SkillsView: React.FC = () => {
  // ── 数据状态 ──
  const [skills, setSkills] = useState<SkillItem[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  // ── 弹窗状态 ──
  const [showCreate, setShowCreate] = useState(false)
  const [createForm, setCreateForm] = useState<CreateSkillForm>(INITIAL_FORM)
  const [saving, setSaving] = useState(false)
  const [editTarget, setEditTarget] = useState<SkillItem | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  // ── 通知 ──
  const showNotification = useCallback((type: 'success' | 'error', message: string) => {
    setNotification({ type, message })
    setTimeout(() => setNotification(null), 3000)
  }, [])

  // ── 加载技能数据 ──
  const loadSkills = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params: { type: string; keywords?: string; limit: number; offset: number } = {
        type: 'skill',
        limit: PAGE_SIZE,
        offset,
      }
      if (searchQuery.trim()) {
        params.keywords = searchQuery.trim()
      }
      const result = await memoryApi.list(params)
      const mapped: SkillItem[] = result.memories.map((m: Record<string, unknown>) => {
        const content = (m.content as Record<string, unknown>) ?? {}
        const parsed = parseSkillContent(content)
        const tagsArr = (m.tags as string[]) ?? []
        const skillName = (content.skill_name as string) ?? tagsArr[0] ?? '未命名技能'
        return {
          id: m.id as string,
          skillName,
          description: parsed.description,
          code: parsed.code,
          parameters: parsed.parameters,
          successRate: parsed.successRate,
          usageCount: parsed.usageCount,
          lastUsed: parsed.lastUsed,
          tags: tagsArr,
          importance: (m.importance as number) ?? 5,
          createdAt: (m.createdAt as number) ?? Date.now(),
          updatedAt: (m.updatedAt as number) ?? Date.now(),
        }
      })
      setSkills(mapped)
      setTotal(result.total)
    } catch (err) {
      setError(`加载技能失败: ${(err as Error).message}`)
    } finally {
      setLoading(false)
    }
  }, [offset, searchQuery])

  useEffect(() => {
    loadSkills()
  }, [loadSkills])

  // ── 创建技能 ──
  const handleCreate = useCallback(async () => {
    if (!createForm.skillName.trim()) {
      showNotification('error', '请输入技能名称')
      return
    }
    setSaving(true)
    try {
      const parameters = createForm.parameters
        .split(',')
        .map(p => p.trim())
        .filter(Boolean)
      const tags = [
        createForm.skillName.trim(),
        ...createForm.tags.split(',').map(t => t.trim()).filter(Boolean),
      ]
      const content = buildSkillContent({
        description: createForm.description,
        code: createForm.code || undefined,
        parameters,
        successRate: 0,
        usageCount: 0,
        lastUsed: Date.now(),
      })
      content.skill_name = createForm.skillName.trim()

      const result = await memoryApi.store({
        type: 'skill',
        branch: 'knowledge',
        content,
        tags,
        importance: createForm.importance,
      })

      if (result.success) {
        showNotification('success', `技能「${createForm.skillName}」创建成功`)
        setShowCreate(false)
        setEditTarget(null)
        setCreateForm(INITIAL_FORM)
        setOffset(0)
        loadSkills()
      } else {
        showNotification('error', result.error || '创建失败')
      }
    } catch (err) {
      showNotification('error', `创建失败: ${(err as Error).message}`)
    } finally {
      setSaving(false)
    }
  }, [createForm, loadSkills, showNotification])

  // ── 编辑技能 ──
  const openEdit = useCallback((skill: SkillItem) => {
    setEditTarget(skill)
    setCreateForm({
      skillName: skill.skillName,
      description: skill.description,
      code: skill.code ?? '',
      parameters: skill.parameters.join(', '),
      tags: skill.tags.filter(t => t !== skill.skillName).join(', '),
      importance: skill.importance,
    })
    setShowCreate(true)
  }, [])

  const handleUpdate = useCallback(async () => {
    if (!editTarget) return
    if (!createForm.skillName.trim()) {
      showNotification('error', '请输入技能名称')
      return
    }
    setSaving(true)
    try {
      const parameters = createForm.parameters
        .split(',')
        .map(p => p.trim())
        .filter(Boolean)
      const tags = [
        createForm.skillName.trim(),
        ...createForm.tags.split(',').map(t => t.trim()).filter(Boolean),
      ]
      const content = buildSkillContent({
        description: createForm.description,
        code: createForm.code || undefined,
        parameters,
        successRate: editTarget.successRate,
        usageCount: editTarget.usageCount,
        lastUsed: editTarget.lastUsed,
      })
      content.skill_name = createForm.skillName.trim()

      const result = await memoryApi.update(editTarget.id, {
        content,
        tags,
        importance: createForm.importance,
      } as Record<string, unknown>)

      if (result.success) {
        showNotification('success', `技能「${createForm.skillName}」更新成功`)
        setShowCreate(false)
        setEditTarget(null)
        setCreateForm(INITIAL_FORM)
        loadSkills()
      } else {
        showNotification('error', result.error || '更新失败')
      }
    } catch (err) {
      showNotification('error', `更新失败: ${(err as Error).message}`)
    } finally {
      setSaving(false)
    }
  }, [editTarget, createForm, loadSkills, showNotification])

  // ── 删除技能 ──
  const confirmDelete = useCallback(async (id: string) => {
    setSaving(true)
    try {
      const result = await memoryApi.forget(id)
      if (result.success) {
        showNotification('success', '技能删除成功')
        setDeleteConfirm(null)
        loadSkills()
      } else {
        showNotification('error', result.error || '删除失败')
      }
    } catch (err) {
      showNotification('error', `删除失败: ${(err as Error).message}`)
    } finally {
      setSaving(false)
    }
  }, [loadSkills, showNotification])

  const totalPages = Math.ceil(total / PAGE_SIZE)
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1

  return (
    <div className="flex flex-col h-full">
      {/* 通知 */}
      {notification && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-2 rounded-lg shadow-lg text-sm ${
          notification.type === 'success' ? 'bg-green-100 text-green-800 border border-green-200' : 'bg-red-100 text-red-800 border border-red-200'
        }`}>
          {notification.message}
        </div>
      )}

      {/* 标题栏 */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold text-gray-700">技能管理</h2>
        <Button size="sm" onPress={() => { setEditTarget(null); setCreateForm(INITIAL_FORM); setShowCreate(true) }}>
          + 新建技能
        </Button>
      </div>

      {/* 搜索栏 */}
      <div className="flex items-center gap-3 mb-4">
        <input
          type="text"
          placeholder="搜索技能名称..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-64 px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-blue-300"
        />
        <Button size="sm" onPress={loadSkills}>
          搜索
        </Button>
      </div>

      {/* 加载状态 */}
      {loading && (
        <div className="flex items-center justify-center py-8">
          <ProgressBar isIndeterminate size="sm" className="max-w-md" />
        </div>
      )}

      {/* 错误状态 */}
      {error && !loading && (
        <div className="flex items-center justify-center py-8">
          <div className="text-center">
            <p className="text-sm text-red-500 mb-2">{error}</p>
            <Button size="sm" variant="secondary" onPress={loadSkills}>重试</Button>
          </div>
        </div>
      )}

      {/* 技能列表 */}
      {!loading && !error && (
        <>
          <div className="flex-1 min-h-0 overflow-y-auto">
            <Table>
              <Table.ScrollContainer>
                <Table.Content aria-label="技能列表" className="min-w-[900px]">
                  <Table.Header>
                    <Table.Column isRowHeader>技能名称</Table.Column>
                    <Table.Column>描述</Table.Column>
                    <Table.Column>参数</Table.Column>
                    <Table.Column>成功率</Table.Column>
                    <Table.Column>使用次数</Table.Column>
                    <Table.Column>重要度</Table.Column>
                    <Table.Column>操作</Table.Column>
                  </Table.Header>
                  <Table.Body>
                    {skills.length > 0 ? (
                      skills.map(skill => (
                        <Table.Row key={skill.id} id={skill.id}>
                          <Table.Cell>
                            <span className="text-sm font-medium text-gray-700">{skill.skillName}</span>
                          </Table.Cell>
                          <Table.Cell>
                            <span className="text-xs text-gray-500 line-clamp-2 max-w-[250px] block">
                              {skill.description || '-'}
                            </span>
                          </Table.Cell>
                          <Table.Cell>
                            <span className="text-xs text-gray-400">
                              {skill.parameters.length > 0 ? skill.parameters.join(', ') : '-'}
                            </span>
                          </Table.Cell>
                          <Table.Cell>
                            <Chip color={getSuccessRateColor(skill.successRate)} variant="soft" size="sm">
                              {skill.successRate}%
                            </Chip>
                          </Table.Cell>
                          <Table.Cell>
                            <span className="text-xs text-gray-500">{skill.usageCount} 次</span>
                          </Table.Cell>
                          <Table.Cell>
                            <Chip
                              color={skill.importance >= 8 ? 'danger' : skill.importance >= 5 ? 'warning' : 'success'}
                              variant="soft"
                              size="sm"
                            >
                              {skill.importance}
                            </Chip>
                          </Table.Cell>
                          <Table.Cell>
                            <div className="flex items-center gap-1">
                              <Button size="sm" variant="tertiary" onPress={() => openEdit(skill)}>
                                编辑
                              </Button>
                              <Button size="sm" variant="danger" onPress={() => setDeleteConfirm(skill.id)}>
                                删除
                              </Button>
                            </div>
                          </Table.Cell>
                        </Table.Row>
                      ))
                    ) : (
                      <Table.Row id="empty">
                        <Table.Cell>
                          <span className="text-xs text-gray-400">暂无技能数据</span>
                        </Table.Cell>
                        <Table.Cell />
                        <Table.Cell />
                        <Table.Cell />
                        <Table.Cell />
                        <Table.Cell />
                        <Table.Cell />
                      </Table.Row>
                    )}
                  </Table.Body>
                </Table.Content>
              </Table.ScrollContainer>
            </Table>
          </div>

          {/* 分页 */}
          {total > PAGE_SIZE && (
            <div className="flex items-center justify-between pt-3 border-t border-gray-100 mt-2">
              <span className="text-xs text-gray-400">
                共 {total} 条，第 {currentPage}/{totalPages} 页
              </span>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="tertiary" isDisabled={offset === 0} onPress={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
                  上一页
                </Button>
                <Button size="sm" variant="tertiary" isDisabled={offset + PAGE_SIZE >= total} onPress={() => setOffset(offset + PAGE_SIZE)}>
                  下一页
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {/* 新建/编辑弹窗 */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => { setShowCreate(false); setEditTarget(null); setCreateForm(INITIAL_FORM) }}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[85vh] overflow-y-auto mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-gray-100">
              <h3 className="text-base font-semibold text-gray-700">{editTarget ? '编辑技能' : '新建技能'}</h3>
            </div>
            <div className="px-6 py-4 space-y-4">
              {/* 技能名称 */}
              <div>
                <label className="block text-sm text-gray-500 mb-1">技能名称 *</label>
                <input
                  type="text"
                  value={createForm.skillName}
                  onChange={(e) => setCreateForm({ ...createForm, skillName: e.target.value })}
                  placeholder="例如：自动树场建造"
                  className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-blue-300"
                />
              </div>

              {/* 描述 */}
              <div>
                <label className="block text-sm text-gray-500 mb-1">描述</label>
                <textarea
                  className="w-full h-24 p-2 text-sm border border-gray-200 rounded-lg resize-none focus:outline-none focus:border-blue-300"
                  value={createForm.description}
                  onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
                  placeholder="技能描述，说明用途和使用场景..."
                />
              </div>

              {/* 技能代码 */}
              <div>
                <label className="block text-sm text-gray-500 mb-1">技能代码（可选）</label>
                <textarea
                  className="w-full h-20 p-2 text-xs font-mono border border-gray-200 rounded-lg resize-none focus:outline-none focus:border-blue-300"
                  value={createForm.code}
                  onChange={(e) => setCreateForm({ ...createForm, code: e.target.value })}
                  placeholder="技能实现代码或脚本..."
                />
              </div>

              {/* 参数列表 */}
              <div>
                <label className="block text-sm text-gray-500 mb-1">参数列表（逗号分隔）</label>
                <input
                  type="text"
                  value={createForm.parameters}
                  onChange={(e) => setCreateForm({ ...createForm, parameters: e.target.value })}
                  placeholder="例如：target_x, target_z, material"
                  className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-blue-300"
                />
              </div>

              {/* 标签 */}
              <div>
                <label className="block text-sm text-gray-500 mb-1">标签（逗号分隔，技能名自动添加）</label>
                <input
                  type="text"
                  value={createForm.tags}
                  onChange={(e) => setCreateForm({ ...createForm, tags: e.target.value })}
                  placeholder="例如：红石, 自动化, 建筑"
                  className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-blue-300"
                />
              </div>

              {/* 重要度 */}
              <div>
                <label className="block text-sm text-gray-500 mb-1">重要度（1-10）</label>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={1}
                    max={10}
                    value={createForm.importance}
                    onChange={(e) => setCreateForm({ ...createForm, importance: parseInt(e.target.value) })}
                    className="flex-1"
                  />
                  <span className="text-sm font-mono text-gray-600 w-6 text-center">{createForm.importance}</span>
                </div>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2">
              <Button variant="secondary" onPress={() => { setShowCreate(false); setEditTarget(null); setCreateForm(INITIAL_FORM) }}>
                取消
              </Button>
              <Button isDisabled={saving} onPress={editTarget ? handleUpdate : handleCreate}>
                {saving ? '保存中...' : (editTarget ? '保存修改' : '创建')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* 删除确认弹窗 */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setDeleteConfirm(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm mx-4 p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-gray-700 mb-2">确认删除</h3>
            <p className="text-sm text-gray-600 mb-6">确定要删除这个技能吗？删除后不可恢复。</p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onPress={() => setDeleteConfirm(null)}>取消</Button>
              <Button variant="danger" isDisabled={saving} onPress={() => deleteConfirm && confirmDelete(deleteConfirm)}>
                {saving ? '删除中...' : '确认删除'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default SkillsView
