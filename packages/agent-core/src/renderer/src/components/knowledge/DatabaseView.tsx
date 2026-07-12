/**
 * DatabaseView — 资料库视图
 *
 * 每个文档集独立表格。重要性在编辑弹窗中修改，表格仅展示。
 * 操作按钮使用图标（✎ / 🗑）。
 * 默认文档集防重复（清理 + 锁）。
 */

import React, { useState, useEffect, useRef } from 'react'
import { Table, Button, Chip, Switch, ProgressBar } from '@heroui/react'
import { memoryApi } from '../../lib/ipc'
import AddKnowledgeModal from './AddKnowledgeModal'

interface DocSet { id: string; name: string; builtIn: boolean; entryCount: number }
interface Entry {
  id: string; title: string; sourceType: string; content: Record<string, unknown>; tags: string[]; importance: number; createdAt: number; updatedAt: number
}
interface BuiltinItem { id: string; name: string; desc: string; icon: React.FC; enabled: boolean }

const DEFAULT = 'default'
const SRC: Record<string, { l: string; c: 'accent' | 'warning' | 'success' }> = {
  url: { l: 'URL', c: 'accent' }, document: { l: '文档', c: 'warning' }, manual: { l: '手动', c: 'success' },
}
function fmt(ts: number) { return ts ? new Date(ts).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-' }
function dsId(tags: string[]) { const t = tags.find(t => t.startsWith('ds:')); return t ? t.slice(3) : DEFAULT }

const PencilIcon: React.FC = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="align-middle">
    <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
  </svg>
)
const TrashIcon: React.FC = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="align-middle">
    <path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
  </svg>
)
const WikiIcon: React.FC = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-gray-400 shrink-0">
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    <circle cx="12" cy="11" r="3" /><path d="M12 7V4" /><path d="M12 15v3" />
  </svg>
)
const SearchIcon: React.FC = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-gray-400 shrink-0">
    <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
  </svg>
)
const BUILTINS: BuiltinItem[] = [
  { id: 'wiki', name: 'Minecraft Wiki', desc: '在对话中搜索 Minecraft Wiki', icon: WikiIcon, enabled: false },
  { id: 'web_search', name: '网页搜索', desc: '搜索互联网（DuckDuckGo）', icon: SearchIcon, enabled: false },
]

// ── 保证有且仅有一个默认文档集（调用端防重 + API 幂等） ──
async function ensureDS(): Promise<void> {
  const r = await memoryApi.list({ type: 'doc_set', branch: 'knowledge', limit: 100 })
  // memoryApi.list 在浏览器模式下可能返回 undefined
  const list = (r as any)?.memories ?? []
  const defaults = list.filter((m: any) => m.content?.id === DEFAULT)
  for (let i = 1; i < defaults.length; i++) {
    const ret = await memoryApi.forget(defaults[i].id) as any
    // forget 在浏览器模式返回 undefined，静默忽略
  }
  if (defaults.length === 0) {
    await memoryApi.store({ type: 'doc_set', branch: 'knowledge', content: { id: DEFAULT, name: '默认文档集', builtIn: true }, tags: ['ds-meta'], importance: 1 })
  }
}

const DatabaseView: React.FC = () => {
  const [sets, setSets] = useState<DocSet[]>([])
  const [entriesMap, setEntriesMap] = useState<Record<string, Entry[]>>({})
  const [builtins, setBuiltins] = useState(BUILTINS)
  const [loading, setLoading] = useState(true)
  const [n, setN] = useState<{ t: 's' | 'e'; m: string } | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [targetSet, setTargetSet] = useState(DEFAULT)
  const [editingEntry, setEditingEntry] = useState<Entry | null>(null)
  const [newName, setNewName] = useState('')
  const [renId, setRenId] = useState<string | null>(null)
  const [renName, setRenName] = useState('')
  const initRef = useRef(false)
  const entriesRef = useRef(entriesMap)
  entriesRef.current = entriesMap

  const nt = (t: 's' | 'e', m: string) => { setN({ t, m }); setTimeout(() => setN(null), 3000) }

  // 全量加载（仅首次）
  useEffect(() => {
    if (initRef.current) return
    initRef.current = true
    ;(async () => {
      try {
        await ensureDS()
        const [sr, tr] = await Promise.all([
          memoryApi.list({ type: 'doc_set', branch: 'knowledge', limit: 100 }),
          (async () => {
            const r = await memoryApi.list({ type: 'builtin_toggle', branch: 'knowledge', limit: 10 })
            const m: Record<string, boolean> = {}
            for (const x of r.memories) { const c = x.content ?? {}; m[c.id as string] = !!c.enabled }
            return m
          })(),
        ])
        const ds: DocSet[] = sr.memories.map((m: any) => ({ id: m.content?.id ?? DEFAULT, name: m.content?.name ?? '', builtIn: m.content?.builtIn ?? false, entryCount: 0 }))
        setSets(ds)
        setBuiltins(prev => prev.map(b => ({ ...b, enabled: tr[b.id] ?? false })))
        const em: Record<string, Entry[]> = {}
        await Promise.all(ds.map(async (d) => {
          const r = await memoryApi.list({ branch: 'knowledge', tags: [`ds:${d.id}`], limit: 500 })
          em[d.id] = r.memories.filter((m: any) => m.type !== 'doc_set' && m.type !== 'skill').map((m: any) => {
            const c = m.content ?? {}
            return { id: m.id, title: c.title ?? c.fileName ?? `#${m.id.slice(0, 6)}`, sourceType: c.sourceType || '', content: c, tags: m.tags ?? [], importance: m.importance ?? 5, createdAt: m.createdAt ?? 0, updatedAt: m.updatedAt ?? 0 }
          })
        }))
        setEntriesMap(em)
      } catch (e) { nt('e', `加载失败: ${(e as Error).message}`) } finally { setLoading(false) }
    })()
  }, [])

  const handleEdit = (entry: Entry) => {
    setTargetSet(dsId(entry.tags))
    setEditingEntry(entry)
    setShowAdd(true)
  }

  const handleDelete = async (id: string) => {
    try { await memoryApi.forget(id); nt('s', '已删除') } catch { nt('e', '删除失败') }
  }

  // 删除后从 entriesMap 移除 + 刷新
  const doDelAndRefresh = async (id: string) => {
    await handleDelete(id)
    // 从本地状态移除（无论 API 成功与否）
    setEntriesMap(prev => {
      const next: Record<string, Entry[]> = {}
      for (const k of Object.keys(prev)) next[k] = prev[k].filter(e => e.id !== id)
      return next
    })
  }

  const handleToggle = async (id: string, enabled: boolean) => {
    setBuiltins(prev => prev.map(b => b.id === id ? { ...b, enabled } : b))
    const r = await memoryApi.list({ type: 'builtin_toggle', branch: 'knowledge', limit: 10 })
    const existing = r.memories.find((m: any) => m.content?.id === id)
    if (existing) await memoryApi.update(existing.id, { content: { ...existing.content, enabled } } as any)
    else await memoryApi.store({ type: 'builtin_toggle', branch: 'knowledge', content: { id, enabled }, tags: ['builtin'], importance: 1 })
  }

  const doCreate = async () => {
    if (!newName.trim()) return; const id = 'ds_' + Date.now().toString(36)
    await memoryApi.store({ type: 'doc_set', branch: 'knowledge', content: { id, name: newName.trim(), builtIn: false }, tags: ['ds-meta'], importance: 1 })
    setNewName(''); nt('s', '已创建')
    setSets(prev => [...prev, { id, name: newName.trim(), builtIn: false, entryCount: 0 }])
    setEntriesMap(prev => ({ ...prev, [id]: [] }))
  }

  const doRename = async () => {
    if (!renId || !renName.trim()) return
    const r = await memoryApi.list({ type: 'doc_set', branch: 'knowledge', limit: 100 })
    const t = r.memories.find((m: any) => m.content?.id === renId)
    if (t) await memoryApi.update(t.id, { content: { ...t.content, name: renName.trim() } } as any)
    setRenId(null); nt('s', '已重命名')
    setSets(prev => prev.map(s => s.id === renId ? { ...s, name: renName.trim() } : s))
  }

  const doDelSet = async (id: string) => {
    if (id === DEFAULT) return
    const r = await memoryApi.list({ branch: 'knowledge', tags: [`ds:${id}`], limit: 1000 })
    for (const e of r.memories) await memoryApi.forget(e.id)
    const all = await memoryApi.list({ type: 'doc_set', branch: 'knowledge', limit: 100 })
    const t = all.memories.find((m: any) => m.content?.id === id)
    if (t) await memoryApi.forget(t.id)
    setSets(prev => prev.filter(s => s.id !== id))
    setEntriesMap(prev => { const { [id]: _, ...rest } = prev; return rest })
    nt('s', '已删除')
  }

  const handleSaved = () => {
    nt('s', '已保存')
    setShowAdd(false)
    setEditingEntry(null)
    ;(async () => {
      for (const set of sets) {
        const r = await memoryApi.list({ branch: 'knowledge', tags: [`ds:${set.id}`], limit: 500 })
        setEntriesMap(prev => ({
          ...prev,
          [set.id]: r.memories.filter((m: any) => m.type !== 'doc_set' && m.type !== 'skill').map((m: any) => {
            const c = m.content ?? {}
            return { id: m.id, title: c.title ?? c.fileName ?? `#${m.id.slice(0, 6)}`, sourceType: c.sourceType || '', content: c, tags: m.tags ?? [], importance: m.importance ?? 5, createdAt: m.createdAt ?? 0, updatedAt: m.updatedAt ?? 0 }
          }),
        }))
      }
    })()
  }

  if (loading) return <div className="py-8"><ProgressBar isIndeterminate size="sm" className="max-w-md mx-auto" /></div>

  // UI 级去重：按 content.id 去重，防止 API 层面 cleanup 未生效
  const seenIds = new Set<string>()
  const uniqueSets = sets.filter(s => {
    if (seenIds.has(s.id)) return false
    seenIds.add(s.id)
    return true
  })

  return (
    <div className="overflow-y-auto pr-1">
      {n && <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-[60] px-4 py-2 rounded-lg shadow-lg text-sm ${n.t === 's' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>{n.m}</div>}

      <h2 className="text-base font-semibold text-gray-700 mb-3">资料库管理</h2>

      {/* 创建文档集 */}
      <div className="flex items-center gap-2 mb-5">
        <input type="text" value={newName} onChange={e => setNewName(e.target.value)} placeholder="新文档集名称..."
          className="flex-1 max-w-xs px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-blue-300" />
        <Button size="sm" isDisabled={!newName.trim()} onPress={doCreate}>创建文档集</Button>
      </div>

      {/* 每个文档集一个表格（UI 去重后） */}
      {uniqueSets.map(set => {
        const entries = entriesMap[set.id] ?? []
        return (
          <div key={set.id} className="mb-6">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-gray-700">{set.name}</h3>
                {set.builtIn && <Chip variant="soft" size="sm" color="default">默认</Chip>}
                {!set.builtIn && (
                  <div className="flex items-center gap-1 ml-1">
                    <button onClick={() => { setRenId(set.id); setRenName(set.name) }} className="text-gray-400 hover:text-blue-500"><PencilIcon /></button>
                    <button onClick={() => doDelSet(set.id)} className="text-red-400 hover:text-red-600"><TrashIcon /></button>
                  </div>
                )}
                {renId === set.id && (
                  <div className="flex items-center gap-1 ml-2">
                    <input type="text" value={renName} onChange={e => setRenName(e.target.value)} className="w-20 px-1 py-0.5 text-xs border rounded" autoFocus />
                    <button onClick={doRename} className="text-xs text-blue-500">✓</button>
                    <button onClick={() => setRenId(null)} className="text-xs text-gray-400">✕</button>
                  </div>
                )}
              </div>
              <Button size="sm" className="!min-w-0 !px-3 !h-7 !text-xs" onPress={() => { setTargetSet(set.id); setEditingEntry(null); setShowAdd(true) }}>+ 添加</Button>
            </div>

            <Table>
              <Table.ScrollContainer>
                <Table.Content aria-label={set.name} className="min-w-[600px]">
                  <Table.Header>
                    <Table.Column isRowHeader>标题</Table.Column>
                    <Table.Column>来源</Table.Column>
                    <Table.Column>标签</Table.Column>
                    <Table.Column>重要度</Table.Column>
                    <Table.Column>更新</Table.Column>
                    <Table.Column>操作</Table.Column>
                  </Table.Header>
                  <Table.Body>
                    {entries.length > 0 ? entries.map(e => {
                      const sc = SRC[e.sourceType]
                      return (
                        <Table.Row key={e.id}>
                          <Table.Cell><span className="text-sm text-gray-700 truncate max-w-[160px] block">{e.title}</span></Table.Cell>
                          <Table.Cell>{sc ? <Chip color={sc.c} variant="soft" size="sm">{sc.l}</Chip> : <span className="text-xs text-gray-400">-</span>}</Table.Cell>
                          <Table.Cell>
                            <div className="flex gap-1 flex-wrap max-w-[120px]">
                              {e.tags.filter(t => !t.startsWith('ds:')).slice(0, 2).map(t => <span key={t} className="px-1 py-0.5 text-[10px] text-gray-500 bg-gray-100 rounded">{t}</span>)}
                              {e.tags.filter(t => !t.startsWith('ds:')).length > 2 && <span className="text-[10px] text-gray-400">+{e.tags.filter(t => !t.startsWith('ds:')).length - 2}</span>}
                            </div>
                          </Table.Cell>
                          <Table.Cell>
                            <span className={`text-xs font-mono ${e.importance >= 8 ? 'text-red-500 font-semibold' : e.importance >= 5 ? 'text-amber-500' : 'text-gray-400'}`}>
                              {e.importance}/10
                            </span>
                          </Table.Cell>
                          <Table.Cell><span className="text-xs text-gray-400">{fmt(e.updatedAt)}</span></Table.Cell>
                          <Table.Cell>
                            <div className="flex items-center gap-2">
                              <button onClick={() => handleEdit(e)} className="text-blue-500 hover:text-blue-700" title="编辑"><PencilIcon /></button>
                              <button onClick={() => doDelAndRefresh(e.id)} className="text-red-400 hover:text-red-600" title="删除"><TrashIcon /></button>
                            </div>
                          </Table.Cell>
                        </Table.Row>
                      )
                    }) : (
                      <Table.Row><Table.Cell colSpan={6}><div className="text-center text-xs text-gray-400 py-4">暂无条目</div></Table.Cell></Table.Row>
                    )}
                  </Table.Body>
                </Table.Content>
              </Table.ScrollContainer>
            </Table>
          </div>
        )
      })}

      {/* 内置 */}
      <div className="mt-5 pt-4 border-t border-gray-100">
        <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-3">内置</h3>
        <Table variant="secondary">
          <Table.ScrollContainer>
            <Table.Content aria-label="内置" className="min-w-[400px]">
              <Table.Header>
                <Table.Column isRowHeader>名称</Table.Column>
                <Table.Column>说明</Table.Column>
                <Table.Column>状态</Table.Column>
              </Table.Header>
              <Table.Body>
                {builtins.map(b => {
                  const Icon = b.icon
                  return (
                    <Table.Row key={b.id}>
                      <Table.Cell>
                        <div className="flex items-center gap-2.5">
                          <Icon /><span className="text-sm text-gray-700">{b.name}</span>
                        </div>
                      </Table.Cell>
                      <Table.Cell><span className="text-xs text-gray-400">{b.desc}</span></Table.Cell>
                      <Table.Cell>
                        <Switch isSelected={b.enabled} onChange={v => handleToggle(b.id, v)} aria-label={b.name} size="sm">
                          <Switch.Content><Switch.Control><Switch.Thumb /></Switch.Control></Switch.Content>
                        </Switch>
                      </Table.Cell>
                    </Table.Row>
                  )
                })}
              </Table.Body>
            </Table.Content>
          </Table.ScrollContainer>
        </Table>
      </div>

      <AddKnowledgeModal
        open={showAdd}
        editingEntry={editingEntry ? { id: editingEntry.id, title: editingEntry.title, sourceType: editingEntry.sourceType, content: editingEntry.content, tags: editingEntry.tags, importance: editingEntry.importance } : null}
        docSets={sets}
        activeDocSetId={targetSet}
        onClose={() => { setShowAdd(false); setEditingEntry(null) }}
        onSaved={handleSaved}
      />
    </div>
  )
}

export default DatabaseView
