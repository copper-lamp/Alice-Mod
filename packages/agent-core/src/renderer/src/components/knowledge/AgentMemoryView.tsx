/**
 * AgentMemoryView — 记忆浏览器 UI
 *
 * 支持：
 * - 按 type / tags / keywords 过滤检索
 * - 查看记忆详情（元数据 + 内容 JSON + 标签）
 * - 编辑记忆内容（content / tags / importance）
 * - 删除记忆（含确认对话框）
 * - 语义搜索
 * - 加载中 / 空数据 / 错误状态
 */

import React, { useState, useEffect, useCallback } from 'react'
import { Table, TextField, Input, Chip, Button, Select, ProgressBar, Modal, ModalHeader, ModalBody, ModalFooter, ModalDialog } from '@heroui/react'
import { memoryApi } from '../../lib/ipc'

interface MemoryItem {
  id: string
  type: string
  branch: string
  content: Record<string, unknown>
  tags: string[]
  importance: number
  accessCount: number
  createdAt: number
  updatedAt: number
  similarityScore?: number
}

interface DetailModalData {
  memory: MemoryItem | null
  editContent: string
  editTags: string
  editImportance: number
}

type SortField = 'created_at' | 'updated_at' | 'importance'
type SortDir = 'asc' | 'desc'

const MEMORY_TYPES = [
  { value: '', label: '全部类型' },
  { value: 'player_habit', label: '玩家习惯' },
  { value: 'map_point', label: '地图坐标' },
  { value: 'task_experience', label: '任务经验' },
  { value: 'social', label: '社交关系' },
  { value: 'skill', label: '技能' },
  { value: 'map_region', label: '命名区域' },
  { value: 'map_biome', label: '生物群系' },
]

const PAGE_SIZE = 20

const AgentMemoryView: React.FC = () => {
  // ── 状态 ──
  const [memories, setMemories] = useState<MemoryItem[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 筛选
  const [filterType, setFilterType] = useState('')
  const [filterKeywords, setFilterKeywords] = useState('')
  const [filterTags, setFilterTags] = useState('')
  const [sortField, setSortField] = useState<SortField>('created_at')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  // 语义搜索
  const [semanticQuery, setSemanticQuery] = useState('')
  const [semanticMode, setSemanticMode] = useState(false)

  // 详情弹窗
  const [detailModal, setDetailModal] = useState<DetailModalData | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  // ── 加载数据 ──
  const loadMemories = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      if (semanticMode && semanticQuery.trim()) {
        const result = await memoryApi.similar(semanticQuery, filterType || undefined, PAGE_SIZE)
        setMemories(result.memories.map(m => ({
          ...m,
          importance: m.importance ?? 5,
          accessCount: m.accessCount ?? 0,
          createdAt: m.createdAt ?? Date.now(),
          updatedAt: m.updatedAt ?? Date.now(),
        })))
        setTotal(result.memories.length)
        setOffset(0)
      } else {
        const result = await memoryApi.list({
          type: filterType || undefined,
          tags: filterTags.trim() ? filterTags.split(',').map(t => t.trim()).filter(Boolean) : undefined,
          keywords: filterKeywords.trim() || undefined,
          limit: PAGE_SIZE,
          offset,
        })
        setMemories(result.memories.map(m => ({
          ...m,
          importance: m.importance ?? 5,
          accessCount: m.accessCount ?? 0,
          createdAt: m.createdAt ?? Date.now(),
          updatedAt: m.updatedAt ?? Date.now(),
        })))
        setTotal(result.total)
      }
    } catch (err) {
      setError(`加载记忆失败: ${(err as Error).message}`)
    } finally {
      setLoading(false)
    }
  }, [filterType, filterKeywords, filterTags, offset, semanticMode, semanticQuery])

  useEffect(() => {
    loadMemories()
  }, [loadMemories])

  // ── 通知 ──
  const showNotification = useCallback((type: 'success' | 'error', message: string) => {
    setNotification({ type, message })
    setTimeout(() => setNotification(null), 3000)
  }, [])

  // ── 详情弹窗 ──
  const openDetail = useCallback(async (memory: MemoryItem) => {
    setDetailModal({
      memory,
      editContent: JSON.stringify(memory.content, null, 2),
      editTags: memory.tags.join(', '),
      editImportance: memory.importance,
    })
  }, [])

  const closeDetail = useCallback(() => {
    setDetailModal(null)
  }, [])

  const saveDetail = useCallback(async () => {
    if (!detailModal?.memory) return
    setSaving(true)
    try {
      let content = detailModal.memory.content
      try {
        content = JSON.parse(detailModal.editContent)
      } catch {
        showNotification('error', 'JSON 格式错误，请检查后重试')
        setSaving(false)
        return
      }

      const tags = detailModal.editTags.split(',').map(t => t.trim()).filter(Boolean)
      const importance = Math.max(1, Math.min(10, detailModal.editImportance))

      const result = await memoryApi.update(detailModal.memory.id, {
        content,
        tags,
        importance,
      } as Record<string, unknown>)

      if (result.success) {
        showNotification('success', '记忆更新成功')
        closeDetail()
        loadMemories()
      } else {
        showNotification('error', result.error || '更新失败')
      }
    } catch (err) {
      showNotification('error', `更新失败: ${(err as Error).message}`)
    } finally {
      setSaving(false)
    }
  }, [detailModal, loadMemories, showNotification, closeDetail])

  // ── 删除 ──
  const confirmDelete = useCallback(async (id: string) => {
    setSaving(true)
    try {
      const result = await memoryApi.forget(id)
      if (result.success) {
        showNotification('success', '记忆删除成功')
        setDeleteConfirm(null)
        loadMemories()
      } else {
        showNotification('error', result.error || '删除失败')
      }
    } catch (err) {
      showNotification('error', `删除失败: ${(err as Error).message}`)
    } finally {
      setSaving(false)
    }
  }, [loadMemories, showNotification])

  // ── 格式化时间 ──
  const formatTime = (ts: number) => {
    const d = new Date(ts)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }

  const typeLabel = (type: string) => {
    const t = MEMORY_TYPES.find(t => t.value === type)
    return t ? t.label : type
  }

  const importanceColor = (imp: number): 'danger' | 'warning' | 'success' => {
    if (imp >= 8) return 'danger'
    if (imp >= 5) return 'warning'
    return 'success'
  }

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

      {/* 标题 */}
      <h2 className="text-base font-semibold text-gray-700 mb-4">记忆浏览器</h2>

      {/* 筛选面板 */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <Select
          aria-label="记忆类型"
          selectedKey={filterType}
          onSelectionChange={(key) => setFilterType(key as string)}
          className="w-36"
          size="sm"
        >
          {MEMORY_TYPES.map(t => (
            <Select.Item key={t.value} id={t.value}>{t.label}</Select.Item>
          ))}
        </Select>

        <TextField
          aria-label="关键词搜索"
          placeholder="关键词..."
          value={filterKeywords}
          onChange={setFilterKeywords}
          className="w-44"
          size="sm"
        >
          <Input />
        </TextField>

        <TextField
          aria-label="标签筛选"
          placeholder="标签（逗号分隔）"
          value={filterTags}
          onChange={setFilterTags}
          className="w-44"
          size="sm"
        >
          <Input />
        </TextField>

        {/* 语义搜索 */}
        <TextField
          aria-label="语义搜索"
          placeholder="语义搜索..."
          value={semanticQuery}
          onChange={setSemanticQuery}
          className="w-56"
          size="sm"
        >
          <Input />
        </TextField>

        <Button
          size="sm"
          color={semanticMode ? 'primary' : 'default'}
          variant="flat"
          onClick={() => setSemanticMode(!semanticMode)}
          style={{ color: semanticMode ? '#fff' : undefined, backgroundColor: semanticMode ? '#0070f0' : undefined }}
        >
          {semanticMode ? '语义搜索' : '条件搜索'}
        </Button>

        <Button size="sm" color="primary" variant="flat" onClick={loadMemories} style={{ color: '#fff', backgroundColor: '#0070f0' }}>
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
            <Button size="sm" variant="flat" onClick={loadMemories}>重试</Button>
          </div>
        </div>
      )}

      {/* 记忆列表 */}
      {!loading && !error && (
        <>
          <div className="flex-1 min-h-0 overflow-y-auto">
            <Table>
              <Table.ScrollContainer>
                <Table.Content aria-label="记忆列表" className="min-w-[900px]">
                  <Table.Header>
                    <Table.Column isRowHeader>内容摘要</Table.Column>
                    <Table.Column>类型</Table.Column>
                    <Table.Column>重要度</Table.Column>
                    <Table.Column>标签</Table.Column>
                    <Table.Column>更新时间</Table.Column>
                    <Table.Column>操作</Table.Column>
                  </Table.Header>
                  <Table.Body>
                    {memories.length > 0 ? (
                      memories.map(memory => (
                        <Table.Row key={memory.id} id={memory.id}>
                          <Table.Cell>
                            <span className="text-sm text-gray-700 line-clamp-2">
                              {JSON.stringify(memory.content).slice(0, 100)}
                              {JSON.stringify(memory.content).length > 100 ? '...' : ''}
                            </span>
                          </Table.Cell>
                          <Table.Cell>
                            <Chip variant="flat" size="sm" className="text-xs">
                              {typeLabel(memory.type)}
                            </Chip>
                          </Table.Cell>
                          <Table.Cell>
                            <Chip color={importanceColor(memory.importance)} variant="flat" size="sm">
                              {memory.importance}
                            </Chip>
                          </Table.Cell>
                          <Table.Cell>
                            <div className="flex items-center gap-1 flex-wrap max-w-[200px]">
                              {memory.tags.slice(0, 3).map(tag => (
                                <span key={tag} className="px-1.5 py-0.5 text-[10px] text-gray-500 bg-gray-100 rounded">
                                  {tag}
                                </span>
                              ))}
                              {memory.tags.length > 3 && (
                                <span className="text-[10px] text-gray-400">+{memory.tags.length - 3}</span>
                              )}
                            </div>
                          </Table.Cell>
                          <Table.Cell>
                            <span className="text-xs text-gray-400">{formatTime(memory.updatedAt)}</span>
                          </Table.Cell>
                          <Table.Cell>
                            <div className="flex items-center gap-1">
                              <Button size="sm" variant="flat" className="text-xs min-w-0 px-2 h-6" onClick={() => openDetail(memory)}>
                                查看
                              </Button>
                              <Button size="sm" variant="flat" className="text-xs min-w-0 px-2 h-6 text-red-500" onClick={() => setDeleteConfirm(memory.id)}>
                                删除
                              </Button>
                            </div>
                          </Table.Cell>
                        </Table.Row>
                      ))
                    ) : (
                      <Table.Row id="empty">
                        <Table.Cell>
                          <span className="text-xs text-gray-400">暂无记忆数据</span>
                        </Table.Cell>
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
          {!semanticMode && total > PAGE_SIZE && (
            <div className="flex items-center justify-between pt-3 border-t border-gray-100 mt-2">
              <span className="text-xs text-gray-400">
                共 {total} 条，第 {currentPage}/{totalPages} 页
              </span>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="flat"
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                  className="text-xs"
                >
                  上一页
                </Button>
                <Button
                  size="sm"
                  variant="flat"
                  disabled={offset + PAGE_SIZE >= total}
                  onClick={() => setOffset(offset + PAGE_SIZE)}
                  className="text-xs"
                >
                  下一页
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {/* 详情弹窗 */}
      <Modal isOpen={detailModal !== null} onClose={closeDetail} size="lg">
        <ModalDialog>
          <ModalHeader>
            记忆详情
          </ModalHeader>
          <ModalBody>
            {detailModal && (
              <div className="space-y-4">
                {/* 元数据 */}
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <span className="text-gray-400">ID: </span>
                    <span className="text-gray-600 font-mono text-xs">{detailModal.memory!.id}</span>
                  </div>
                  <div>
                    <span className="text-gray-400">类型: </span>
                    <span className="text-gray-600">{typeLabel(detailModal.memory!.type)}</span>
                  </div>
                  <div>
                    <span className="text-gray-400">分支: </span>
                    <span className="text-gray-600">{detailModal.memory!.branch}</span>
                  </div>
                  <div>
                    <span className="text-gray-400">访问次数: </span>
                    <span className="text-gray-600">{detailModal.memory!.accessCount}</span>
                  </div>
                  <div>
                    <span className="text-gray-400">创建时间: </span>
                    <span className="text-gray-600">{formatTime(detailModal.memory!.createdAt)}</span>
                  </div>
                  <div>
                    <span className="text-gray-400">更新时间: </span>
                    <span className="text-gray-600">{formatTime(detailModal.memory!.updatedAt)}</span>
                  </div>
                </div>

                {/* 内容 JSON 编辑 */}
                <div>
                  <label className="block text-sm text-gray-500 mb-1">内容（JSON）</label>
                  <textarea
                    className="w-full h-32 p-2 text-xs font-mono border border-gray-200 rounded-lg resize-none focus:outline-none focus:border-blue-300"
                    value={detailModal.editContent}
                    onChange={(e) => setDetailModal({ ...detailModal, editContent: e.target.value })}
                  />
                </div>

                {/* 标签编辑 */}
                <div>
                  <label className="block text-sm text-gray-500 mb-1">标签（逗号分隔）</label>
                  <TextField
                    aria-label="标签"
                    value={detailModal.editTags}
                    onChange={(tags) => setDetailModal({ ...detailModal, editTags: tags })}
                    size="sm"
                  >
                    <Input />
                  </TextField>
                </div>

                {/* 重要度编辑 */}
                <div>
                  <label className="block text-sm text-gray-500 mb-1">重要度（1-10）</label>
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min={1}
                      max={10}
                      value={detailModal.editImportance}
                      onChange={(e) => setDetailModal({ ...detailModal, editImportance: parseInt(e.target.value) })}
                      className="flex-1"
                    />
                    <span className="text-sm font-mono text-gray-600 w-6 text-center">{detailModal.editImportance}</span>
                  </div>
                </div>
              </div>
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" size="sm" onClick={closeDetail}>取消</Button>
            <Button color="primary" size="sm" onClick={saveDetail} disabled={saving} style={{ color: '#fff', backgroundColor: '#0070f0' }}>
              {saving ? '保存中...' : '保存'}
            </Button>
          </ModalFooter>
        </ModalDialog>
      </Modal>

      {/* 删除确认弹窗 */}
      <Modal isOpen={deleteConfirm !== null} onClose={() => setDeleteConfirm(null)} size="sm">
        <ModalDialog>
          <ModalHeader>
            确认删除
          </ModalHeader>
          <ModalBody>
            <p className="text-sm text-gray-600">确定要删除这条记忆吗？删除后不可恢复，Chroma 向量和空间索引也会同步清理。</p>
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" size="sm" onClick={() => setDeleteConfirm(null)}>取消</Button>
            <Button
              color="danger"
              size="sm"
              onClick={() => deleteConfirm && confirmDelete(deleteConfirm)}
              disabled={saving}
              style={{ color: '#fff', backgroundColor: '#e53935' }}
            >
              {saving ? '删除中...' : '确认删除'}
            </Button>
          </ModalFooter>
        </ModalDialog>
      </Modal>
    </div>
  )
}

export default AgentMemoryView