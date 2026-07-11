/**
 * AddKnowledgeModal — 添加/编辑弹窗
 *
 * HeroUI: Button
 * 原生表单控件（避免 HeroUI v3 beta 类型不完整问题）
 */

import React, { useState, useEffect } from 'react'
import { Button } from '@heroui/react'
import { memoryApi } from '../../lib/ipc'

type Tab = 'url' | 'document' | 'manual'
interface DS { id: string; name: string; builtIn: boolean; entryCount: number }
interface Props {
  open: boolean
  editingEntry?: { id: string; title: string; sourceType: string; content: Record<string, unknown>; tags: string[]; importance: number } | null
  docSets?: DS[]; activeDocSetId?: string
  onClose: () => void; onSaved: () => void
}

const AddKnowledgeModal: React.FC<Props> = ({ open, editingEntry, docSets, activeDocSetId, onClose, onSaved }) => {
  const edit = !!editingEntry
  const [tab, setTab] = useState<Tab>('url')
  const [url, setUrl] = useState(''); const [urlTitle, setUrlTitle] = useState(''); const [urlDesc, setUrlDesc] = useState('')
  const [docFile, setDocFile] = useState<{ filePath: string; fileName: string; content: string } | null>(null)
  const [docErr, setDocErr] = useState<string | null>(null)
  const [mTitle, setMTitle] = useState(''); const [mContent, setMContent] = useState('')
  const [imp, setImp] = useState(5)
  const [ds, setDs] = useState(activeDocSetId ?? 'default')
  const [busy, setBusy] = useState(false)
  const [n, setN] = useState<{ t: 's' | 'e'; m: string } | null>(null)
  const nt = (t: 's' | 'e', m: string) => { setN({ t, m }); setTimeout(() => setN(null), 3000) }

  useEffect(() => {
    if (editingEntry) {
      const c = editingEntry.content; const st = editingEntry.sourceType || (c.sourceType as string) || ''
      setTab(st as Tab || 'manual'); setImp(editingEntry.importance)
      if (st === 'url') { setUrl((c.url as string) ?? ''); setUrlTitle((c.title as string) ?? editingEntry.title); setUrlDesc((c.description as string) ?? '') }
      else if (st === 'document') setDocFile({ filePath: (c.filePath as string) ?? '', fileName: (c.fileName as string) ?? editingEntry.title, content: (c.content as string) ?? '' })
      else { setMTitle(editingEntry.title); setMContent((c.content as string) ?? '') }
    }
  }, [editingEntry])

  const reset = () => { setUrl(''); setUrlTitle(''); setUrlDesc(''); setDocFile(null); setMTitle(''); setMContent(''); setDocErr(null); setImp(5); setDs(activeDocSetId ?? 'default') }
  const hClose = () => { reset(); onClose() }

  const pickFile = async () => {
    setDocErr(null)
    try {
      const r = await window.electronAPI!.invoke('dialog:open-file') as any
      if (r.canceled) return; if (r.error) { setDocErr(r.error); return }
      setDocFile(r)
    } catch (e) { setDocErr(`打开失败: ${(e as Error).message}`) }
  }

  const hSave = async () => {
    setBusy(true)
    try {
      let content: Record<string, unknown>; let tags: string[]; let title: string
      switch (tab) {
        case 'url': {
          if (!url.trim()) { nt('e', '请输入 URL'); setBusy(false); return }
          content = { sourceType: 'url', url: url.trim(), title: urlTitle.trim(), description: urlDesc.trim() }
          tags = ['url', `ds:${ds}`]; title = urlTitle.trim() || url.trim(); break
        }
        case 'document': {
          if (!docFile) { nt('e', '请选择文件'); setBusy(false); return }
          content = { sourceType: 'document', filePath: docFile.filePath, fileName: docFile.fileName, content: docFile.content }
          tags = ['document', `ds:${ds}`]; title = docFile.fileName; break
        }
        default: {
          if (!mTitle.trim()) { nt('e', '请输入标题'); setBusy(false); return }
          if (!mContent.trim()) { nt('e', '请输入内容'); setBusy(false); return }
          content = { sourceType: 'manual', title: mTitle.trim(), content: mContent.trim() }
          tags = ['manual', `ds:${ds}`]; title = mTitle.trim(); break
        }
      }
      const r = edit && editingEntry
        ? await memoryApi.update(editingEntry.id, { content, tags, importance: imp } as any)
        : await memoryApi.store({ type: 'custom_knowledge', branch: 'knowledge', content, tags, importance: imp })
      if (r.success) { nt('s', `「${title}」${edit ? '已更新' : '已保存'}`); onSaved(); hClose() }
      else nt('e', r.error || '操作失败')
    } catch (e) { nt('e', `失败: ${(e as Error).message}`) } finally { setBusy(false) }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={hClose}>
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[85vh] overflow-y-auto mx-4" onClick={e => e.stopPropagation()}>
        {n && <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-[60] px-4 py-2 rounded-lg shadow-lg text-sm ${n.t === 's' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>{n.m}</div>}
        <div className="px-6 py-4 border-b border-gray-100">
          <h3 className="text-base font-semibold text-gray-700">{edit ? '编辑条目' : '添加知识'}</h3>
        </div>

        {!edit && (
          <div className="flex border-b border-gray-100">
            {([{ k: 'url' as const, l: 'URL' }, { k: 'document' as const, l: '文档' }, { k: 'manual' as const, l: '手动' }]).map(t => (
              <button key={t.k} onClick={() => { setTab(t.k); reset() }}
                className={`flex-1 px-4 py-2.5 text-sm font-medium ${tab === t.k ? 'text-blue-600 border-b-2 border-blue-500' : 'text-gray-500 hover:text-gray-700'}`}>{t.l}</button>
            ))}
          </div>
        )}

        <div className="px-6 py-4 space-y-4">
          {tab === 'url' && (<>
            <div><label className="block text-sm text-gray-500 mb-1">URL *</label>
              <input type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://..."
                className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-blue-300" /></div>
            <div><label className="block text-sm text-gray-500 mb-1">标题</label>
              <input type="text" value={urlTitle} onChange={e => setUrlTitle(e.target.value)} placeholder="页面标题"
                className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-blue-300" /></div>
            <div><label className="block text-sm text-gray-500 mb-1">描述</label>
              <textarea value={urlDesc} onChange={e => setUrlDesc(e.target.value)} className="w-full h-20 p-2 text-sm border border-gray-200 rounded-lg resize-none focus:outline-none focus:border-blue-300" /></div>
          </>)}
          {tab === 'document' && (<>
            <div><label className="block text-sm text-gray-500 mb-2">文件</label>
              <Button size="sm" variant="secondary" onPress={pickFile}>选择文件...</Button>
              {docErr && <p className="mt-2 text-xs text-red-500">{docErr}</p>}</div>
            {docFile && <div className="p-3 bg-gray-50 rounded-lg">
              <p className="text-sm font-medium text-gray-700">{docFile.fileName}</p>
              <p className="text-xs text-gray-400 mt-0.5 break-all">{docFile.filePath}</p>
              <p className="text-xs text-gray-400 mt-1">{docFile.content.length} 字符{docFile.content.length >= 10000 && '（截断）'}</p>
            </div>}
          </>)}
          {tab === 'manual' && (<>
            <div><label className="block text-sm text-gray-500 mb-1">标题 *</label>
              <input type="text" value={mTitle} onChange={e => setMTitle(e.target.value)} placeholder="条目标题"
                className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-blue-300" /></div>
            <div><label className="block text-sm text-gray-500 mb-1">内容 *</label>
              <textarea value={mContent} onChange={e => setMContent(e.target.value)} className="w-full h-40 p-2 text-sm border border-gray-200 rounded-lg resize-none focus:outline-none focus:border-blue-300 font-mono" /></div>
          </>)}
          <div><label className="block text-sm text-gray-500 mb-1">重要度（{imp}）</label>
            <input type="range" min={1} max={10} value={imp} onChange={e => setImp(parseInt(e.target.value))} className="w-full" />
          </div>
          <div><label className="block text-sm text-gray-500 mb-1">文档集</label>
            <select value={ds} onChange={e => setDs(e.target.value)}
              className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-lg bg-white">
              {(docSets ?? []).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2">
          <Button variant="secondary" onPress={hClose}>取消</Button>
          <Button isDisabled={busy} onPress={hSave}>{busy ? '...' : (edit ? '保存' : '添加')}</Button>
        </div>
      </div>
    </div>
  )
}

export default AddKnowledgeModal
