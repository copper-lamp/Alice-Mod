/**
 * DatabaseView — 资料库视图
 *
 * HeroUI: Table, Button, Chip, Switch, ProgressBar
 * 所有条目并列显示，文档集管理独立为底部区域
 */

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Table, Button, Chip, Switch, ProgressBar } from '@heroui/react'
import { memoryApi } from '../../lib/ipc'
import AddKnowledgeModal from './AddKnowledgeModal'

interface Entry {
  id: string; title: string; sourceType: string; content: Record<string, unknown>; tags: string[]; importance: number
  createdAt: number; updatedAt: number; docSetName: string
}
interface DocSet { id: string; name: string; builtIn: boolean; entryCount: number }

const PAGE_SIZE = 50
const DEFAULT = 'default'
const SRC: Record<string, { l: string; c: 'accent' | 'warning' | 'success' }> = {
  url: { l: 'URL', c: 'accent' }, document: { l: '文档', c: 'warning' }, manual: { l: '手动', c: 'success' },
}
function fmt(ts: number) { return ts ? new Date(ts).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-' }
function dsId(tags: string[]) { const t = tags.find(t => t.startsWith('ds:')); return t ? t.slice(3) : DEFAULT }

async function ensureDS() {
  const r = await memoryApi.list({ type: 'doc_set', branch: 'knowledge', limit: 100 })
  if (!r.memories.some((m: any) => m.content?.id === DEFAULT)) {
    await memoryApi.store({ type: 'doc_set', branch: 'knowledge', content: { id: DEFAULT, name: '默认文档集', builtIn: true }, tags: ['ds-meta'], importance: 1 })
  }
}

const DatabaseView: React.FC = () => {
  const [entries, setEntries] = useState<Entry[]>([])
  const [sets, setSets] = useState<DocSet[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [editing, setEditing] = useState<Entry | null>(null)
  const [delId, setDelId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [n, setN] = useState<{ t: 's' | 'e'; m: string } | null>(null)
  const [wiki, setWiki] = useState(false)
  const [web, setWeb] = useState(false)
  const [showMgr, setShowMgr] = useState(false)
  const [newName, setNewName] = useState('')
  const [renId, setRenId] = useState<string | null>(null)
  const [renName, setRenName] = useState('')

  const nt = (t: 's' | 'e', m: string) => { setN({ t, m }); setTimeout(() => setN(null), 3000) }

  // Ref 版文档集名映射，不触发重新渲染
  const dsMapRef = useRef<Record<string, string>>({})
  dsMapRef.current = useMemo(() => Object.fromEntries(sets.map(s => [s.id, s.name])), [sets])

  const loadSets = useCallback(async () => {
    try {
      await ensureDS()
      const r = await memoryApi.list({ type: 'doc_set', branch: 'knowledge', limit: 100 })
      const s: DocSet[] = r.memories.map((m: any) => ({ id: m.content?.id ?? DEFAULT, name: m.content?.name ?? '', builtIn: m.content?.builtIn ?? false, entryCount: 0 }))
      for (const x of s) { const c = await memoryApi.list({ branch: 'knowledge', tags: [`ds:${x.id}`], limit: 0 }); x.entryCount = c.total }
      setSets(s)
    } catch { /* */ }
  }, [])

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const p: any = { branch: 'knowledge', limit: PAGE_SIZE, offset }
      if (query.trim()) p.keywords = query.trim()
      const r = await memoryApi.list(p)
      const map = dsMapRef.current
      setEntries(r.memories.filter((m: any) => m.type !== 'doc_set' && m.type !== 'skill').map((m: any) => {
        const c = m.content ?? {}
        const setId = dsId(m.tags ?? [])
        return {
          id: m.id, title: c.title ?? c.fileName ?? `#${m.id.slice(0, 6)}`,
          sourceType: c.sourceType || '', content: c, tags: m.tags ?? [],
          importance: m.importance ?? 5, createdAt: m.createdAt ?? 0, updatedAt: m.updatedAt ?? 0,
          docSetName: map[setId] ?? '默认文档集',
        }
      }))
      setTotal(r.total)
    } catch (e) { setError(`加载失败: ${(e as Error).message}`) } finally { setLoading(false) }
  }, [offset, query]) // 不再依赖 dsMap

  useEffect(() => { loadSets() }, [loadSets])
  useEffect(() => { load() }, [load])

  const saveImp = async (id: string, v: number) => { await memoryApi.update(id, { importance: v } as any); setEntries(p => p.map(e => e.id === id ? { ...e, importance: v } : e)) }
  const doDel = async () => {
    if (!delId) return; setBusy(true)
    try { await memoryApi.forget(delId); nt('s', '已删除'); setDelId(null); load(); loadSets() } catch { nt('e', '删除失败') } finally { setBusy(false) }
  }
  const doCreate = async () => {
    if (!newName.trim()) return; const id = 'ds_' + Date.now().toString(36)
    await memoryApi.store({ type: 'doc_set', branch: 'knowledge', content: { id, name: newName.trim(), builtIn: false }, tags: ['ds-meta'], importance: 1 })
    setNewName(''); nt('s', '已创建'); loadSets()
  }
  const doRename = async () => {
    if (!renId || !renName.trim()) return
    const r = await memoryApi.list({ type: 'doc_set', branch: 'knowledge', limit: 100 })
    const t = r.memories.find((m: any) => m.content?.id === renId)
    if (t) await memoryApi.update(t.id, { content: { ...t.content, name: renName.trim() } } as any)
    setRenId(null); nt('s', '已重命名'); loadSets()
  }
  const doDelSet = async (id: string) => {
    if (id === DEFAULT) return
    const r = await memoryApi.list({ branch: 'knowledge', tags: [`ds:${id}`], limit: 1000 })
    for (const e of r.memories) await memoryApi.forget(e.id)
    const all = await memoryApi.list({ type: 'doc_set', branch: 'knowledge', limit: 100 })
    const t = all.memories.find((m: any) => m.content?.id === id)
    if (t) await memoryApi.forget(t.id); nt('s', '文档集已删除'); loadSets(); load()
  }

  return (
    <div>
      {n && <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-[60] px-4 py-2 rounded-lg shadow-lg text-sm ${n.t === 's' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>{n.m}</div>}

      <h2 className="text-base font-semibold text-gray-700 mb-3">资料库管理</h2>

      {/* 搜索 + 添加 */}
      <div className="flex items-center gap-3 mb-4">
        <input type="text" value={query} onChange={e => setQuery(e.target.value)} placeholder="在所有文档集中搜索..."
          className="flex-1 px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-blue-300" />
        <Button size="sm" onPress={load}>搜索</Button>
        <button onClick={() => { setEditing(null); setShowAdd(true) }}
          className="w-8 h-8 flex items-center justify-center rounded-full bg-blue-500 text-white hover:bg-blue-600 text-lg leading-none">+</button>
      </div>

      {loading && <div className="py-8"><ProgressBar isIndeterminate size="sm" className="max-w-md mx-auto" /></div>}
      {error && !loading && <div className="text-center py-8"><p className="text-sm text-red-500 mb-2">{error}</p><Button size="sm" variant="secondary" onPress={load}>重试</Button></div>}

      {/* HeroUI Table — 所有条目并列显示 */}
      {!loading && !error && (
        <Table>
          <Table.ScrollContainer>
            <Table.Content aria-label="知识条目" className="min-w-[700px]">
              <Table.Header>
                <Table.Column isRowHeader>标题</Table.Column>
                <Table.Column>来源</Table.Column>
                <Table.Column>文档集</Table.Column>
                <Table.Column>重要度</Table.Column>
                <Table.Column>更新</Table.Column>
                <Table.Column>操作</Table.Column>
              </Table.Header>
              <Table.Body>
                {entries.length > 0 ? entries.map(e => {
                  const sc = SRC[e.sourceType]
                  return (
                    <Table.Row key={e.id}>
                      <Table.Cell><span className="text-sm text-gray-700 truncate max-w-[180px] block">{e.title}</span></Table.Cell>
                      <Table.Cell>{sc ? <Chip color={sc.c} variant="soft" size="sm">{sc.l}</Chip> : '-'}</Table.Cell>
                      <Table.Cell><span className="text-xs text-gray-500">{e.docSetName}</span></Table.Cell>
                      <Table.Cell>
                        <div className="flex items-center gap-2">
                          <input type="range" min={1} max={10} value={e.importance} onChange={ev => saveImp(e.id, parseInt(ev.target.value))} className="w-16 h-1" />
                          <span className={`text-xs font-mono ${e.importance >= 8 ? 'text-red-500' : e.importance >= 5 ? 'text-amber-500' : 'text-gray-400'}`}>{e.importance}</span>
                        </div>
                      </Table.Cell>
                      <Table.Cell><span className="text-xs text-gray-400">{fmt(e.updatedAt)}</span></Table.Cell>
                      <Table.Cell>
                        <div className="flex gap-1">
                          <button onClick={() => { setEditing(e); setShowAdd(true) }} className="text-xs text-blue-500 hover:text-blue-700">编辑</button>
                          <button onClick={() => setDelId(e.id)} className="text-xs text-red-400 hover:text-red-600">删除</button>
                        </div>
                      </Table.Cell>
                    </Table.Row>
                  )
                }) : (
                  <Table.Row>
                    <Table.Cell colSpan={6}><div className="text-center text-xs text-gray-400 py-4">暂无条目</div></Table.Cell>
                  </Table.Row>
                )}
              </Table.Body>
            </Table.Content>
          </Table.ScrollContainer>
          {total > PAGE_SIZE && (
            <Table.Footer>
              <div className="flex items-center justify-between w-full">
                <span className="text-xs text-gray-400">共 {total} 条</span>
                <div className="flex gap-2">
                  <Button size="sm" variant="tertiary" isDisabled={offset === 0} onPress={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>上一页</Button>
                  <Button size="sm" variant="tertiary" isDisabled={offset + PAGE_SIZE >= total} onPress={() => setOffset(offset + PAGE_SIZE)}>下一页</Button>
                </div>
              </div>
            </Table.Footer>
          )}
        </Table>
      )}

      {/* 内置 — Switch */}
      <div className="mt-6 pt-4 border-t border-gray-100">
        <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-3">内置</h3>
        <div className="flex items-center justify-between px-4 py-3 bg-gray-50 rounded-lg mb-2">
          <div className="flex items-center gap-3">
            <WikiIcon /><div><span className="text-sm font-medium text-gray-700">Minecraft Wiki</span><p className="text-xs text-gray-400 mt-0.5">在对话中搜索</p></div>
          </div>
          <Switch isSelected={wiki} onChange={setWiki} aria-label="Wiki"><Switch.Content><Switch.Control><Switch.Thumb /></Switch.Control></Switch.Content></Switch>
        </div>
        <div className="flex items-center justify-between px-4 py-3 bg-gray-50 rounded-lg">
          <div className="flex items-center gap-3">
            <SearchIcon /><div><span className="text-sm font-medium text-gray-700">网页搜索</span><p className="text-xs text-gray-400 mt-0.5">搜索互联网（DuckDuckGo）</p></div>
          </div>
          <Switch isSelected={web} onChange={setWeb} aria-label="搜索"><Switch.Content><Switch.Control><Switch.Thumb /></Switch.Control></Switch.Content></Switch>
        </div>
      </div>

      {/* 文档集管理 — 创建/重命名/删除 */}
      <div className="mt-5 pt-4 border-t border-gray-100">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wider">文档集</h3>
          <button onClick={() => setShowMgr(true)} className="text-xs text-blue-500 hover:text-blue-700">管理</button>
        </div>
        <div className="flex items-center gap-2">
          <input type="text" value={newName} onChange={e => setNewName(e.target.value)} placeholder="新文档集名称..."
            className="flex-1 px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-blue-300" />
          <Button size="sm" isDisabled={!newName.trim()} onPress={doCreate}>创建</Button>
        </div>
        <div className="flex flex-wrap gap-2 mt-3">
          {sets.map(s => (
            <div key={s.id} className="flex items-center gap-1.5 px-2.5 py-1.5 bg-gray-50 rounded-lg text-xs text-gray-600">
              <span>{s.name}</span>
              <span className="text-gray-400">({s.entryCount})</span>
              {s.builtIn && <Chip variant="soft" size="sm" color="default" className="ml-1">内置</Chip>}
              {!s.builtIn && (
                <>
                  <button onClick={() => { setRenId(s.id); setRenName(s.name) }} className="text-gray-400 hover:text-blue-500 ml-1">✎</button>
                  <button onClick={() => doDelSet(s.id)} className="text-gray-400 hover:text-red-500">×</button>
                </>
              )}
              {renId === s.id && (
                <div className="flex items-center gap-1 ml-1">
                  <input type="text" value={renName} onChange={e => setRenName(e.target.value)} className="w-20 px-1 py-0.5 text-xs border rounded" autoFocus />
                  <button onClick={doRename} className="text-blue-500">✓</button>
                  <button onClick={() => setRenId(null)} className="text-gray-400">✕</button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <AddKnowledgeModal open={showAdd} editingEntry={editing} docSets={sets} activeDocSetId="default"
        onClose={() => { setShowAdd(false); setEditing(null) }}
        onSaved={() => { setOffset(0); load(); loadSets() }} />

      {delId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setDelId(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm mx-4 p-6" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-gray-700 mb-2">确认删除</h3>
            <p className="text-sm text-gray-600 mb-6">删除后不可恢复。</p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onPress={() => setDelId(null)}>取消</Button>
              <Button variant="danger" isDisabled={busy} onPress={doDel}>{busy ? '...' : '确认'}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

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

export default DatabaseView
