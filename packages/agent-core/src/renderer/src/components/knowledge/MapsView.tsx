/**
 * MapsView — 地图索引 UI（v2.0 重构）
 *
 * 按维度（主世界/下界/末地）分 3 个表格展示路径点。
 * 支持：新建、编辑名称/坐标/描述、删除。
 * 数据通过 mapsApi 连接后端。
 */

import React, { useState, useEffect, useCallback } from 'react'
import { mapsApi } from '../../lib/ipc'

interface WaypointItem {
  id: string
  dimension: string
  x: number
  y: number
  z: number
  name: string
  description?: string
  tags: string[]
  createdAt: number
  updatedAt: number
}

const DIMENSIONS = [
  { value: 'overworld', label: '主世界', color: 'bg-green-100 text-green-800 border-green-200' },
  { value: 'nether', label: '下界', color: 'bg-red-100 text-red-800 border-red-200' },
  { value: 'the_end', label: '末地', color: 'bg-purple-100 text-purple-800 border-purple-200' },
]

const defaultNewWp = (dim: string) => ({
  dimension: dim,
  x: 0,
  y: 64,
  z: 0,
  name: '',
  description: '',
})

const MapsView: React.FC = () => {
  const [waypoints, setWaypoints] = useState<WaypointItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<{ name: string; x: number; y: number; z: number; description: string }>({ name: '', x: 0, y: 64, z: 0, description: '' })
  const [creatingDim, setCreatingDim] = useState<string | null>(null)
  const [createForm, setCreateForm] = useState<{ name: string; x: number; y: number; z: number; description: string }>({ name: '', x: 0, y: 64, z: 0, description: '' })

  const loadWaypoints = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await mapsApi.list({ limit: 200 })
      setWaypoints((result.waypoints ?? []).map((wp: any) => ({
        id: wp.id ?? '',
        dimension: wp.dimension ?? 'overworld',
        x: typeof wp.x === 'number' ? wp.x : 0,
        y: typeof wp.y === 'number' ? wp.y : 64,
        z: typeof wp.z === 'number' ? wp.z : 0,
        name: wp.name ?? '',
        description: wp.description ?? '',
        tags: Array.isArray(wp.tags) ? wp.tags : [],
        createdAt: wp.createdAt ?? Date.now(),
        updatedAt: wp.updatedAt ?? Date.now(),
      })))
    } catch (err) {
      setError(`加载失败: ${(err as Error).message}`)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadWaypoints()
  }, [loadWaypoints])

  const getDimensionLabel = (dim: string) => {
    const map: Record<string, string> = { overworld: '主世界', nether: '下界', the_end: '末地' }
    return map[dim] ?? dim
  }

  const startEdit = (wp: WaypointItem) => {
    setEditingId(wp.id)
    setEditForm({ name: wp.name, x: wp.x, y: wp.y, z: wp.z, description: wp.description ?? '' })
    setCreatingDim(null)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setCreatingDim(null)
  }

  const handleUpdate = async (id: string) => {
    try {
      const result = await mapsApi.update({ id, name: editForm.name, description: editForm.description })
      if (result.success !== false) {
        setEditingId(null)
        await loadWaypoints()
      } else {
        setError('更新失败')
      }
    } catch (err) {
      setError(`更新失败: ${(err as Error).message}`)
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await mapsApi.delete(id)
      await loadWaypoints()
    } catch (err) {
      setError(`删除失败: ${(err as Error).message}`)
    }
  }

  const handleCreate = async (dim: string) => {
    if (!createForm.name.trim()) {
      setError('请输入名称')
      return
    }
    try {
      await mapsApi.create({
        dimension: dim,
        x: createForm.x,
        y: createForm.y,
        z: createForm.z,
        name: createForm.name.trim(),
        description: createForm.description.trim() || undefined,
      })
      setCreatingDim(null)
      setCreateForm(defaultNewWp(dim))
      await loadWaypoints()
    } catch (err) {
      setError(`创建失败: ${(err as Error).message}`)
    }
  }

  const grouped = (dim: string) => waypoints.filter(wp => wp.dimension === dim)

  const renderTable = (dimInfo: { value: string; label: string; color: string }) => {
    const items = grouped(dimInfo.value)
    return (
      <div key={dimInfo.value} className="border rounded-lg overflow-hidden">
        {/* 维度标题 */}
        <div className={`px-4 py-2 font-medium text-sm flex items-center justify-between ${dimInfo.color} border-b`}>
          <span>{dimInfo.label}（{items.length}）</span>
          <button
            className="text-xs px-2 py-1 rounded bg-white/80 hover:bg-white border"
            onClick={() => {
              setCreatingDim(creatingDim === dimInfo.value ? null : dimInfo.value)
              setEditingId(null)
              setCreateForm(defaultNewWp(dimInfo.value))
            }}
          >
            + 新建
          </button>
        </div>

        {/* 新建表单 */}
        {creatingDim === dimInfo.value && (
          <div className="bg-gray-50 px-4 py-3 border-b space-y-2">
            <div className="flex items-center gap-2">
              <input className="flex-1 border rounded px-2 py-1 text-sm" placeholder="名称 *" value={createForm.name} onChange={e => setCreateForm({ ...createForm, name: e.target.value })} />
              <input className="w-16 border rounded px-2 py-1 text-sm text-center" placeholder="X" type="number" value={createForm.x} onChange={e => setCreateForm({ ...createForm, x: parseInt(e.target.value) || 0 })} />
              <input className="w-16 border rounded px-2 py-1 text-sm text-center" placeholder="Y" type="number" value={createForm.y} onChange={e => setCreateForm({ ...createForm, y: parseInt(e.target.value) || 64 })} />
              <input className="w-16 border rounded px-2 py-1 text-sm text-center" placeholder="Z" type="number" value={createForm.z} onChange={e => setCreateForm({ ...createForm, z: parseInt(e.target.value) || 0 })} />
            </div>
            <div className="flex items-center gap-2">
              <input className="flex-1 border rounded px-2 py-1 text-sm" placeholder="描述（可选）" value={createForm.description} onChange={e => setCreateForm({ ...createForm, description: e.target.value })} />
              <button className="bg-blue-500 text-white text-xs px-3 py-1 rounded hover:bg-blue-600" onClick={() => handleCreate(dimInfo.value)}>确定</button>
              <button className="text-xs px-3 py-1 rounded border hover:bg-gray-100" onClick={() => setCreatingDim(null)}>取消</button>
            </div>
          </div>
        )}

        {/* 表格 */}
        {items.length === 0 && creatingDim !== dimInfo.value ? (
          <div className="text-center py-6 text-gray-400 text-sm">暂无路径点</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-gray-500 text-xs">
                  <th className="text-left px-4 py-2 font-medium">名称</th>
                  <th className="text-left px-2 py-2 font-medium">坐标</th>
                  <th className="text-left px-2 py-2 font-medium">描述</th>
                  <th className="text-right px-4 py-2 font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {items.map(wp => (
                  <tr key={wp.id} className="border-t hover:bg-gray-50">
                    {editingId === wp.id ? (
                      <>
                        <td className="px-4 py-2">
                          <input className="w-full border rounded px-2 py-1 text-sm" value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} />
                        </td>
                        <td className="px-2 py-2">
                          <div className="flex gap-1">
                            <input className="w-14 border rounded px-1 py-1 text-sm text-center" type="number" value={editForm.x} onChange={e => setEditForm({ ...editForm, x: parseInt(e.target.value) || 0 })} />
                            <input className="w-14 border rounded px-1 py-1 text-sm text-center" type="number" value={editForm.y} onChange={e => setEditForm({ ...editForm, y: parseInt(e.target.value) || 64 })} />
                            <input className="w-14 border rounded px-1 py-1 text-sm text-center" type="number" value={editForm.z} onChange={e => setEditForm({ ...editForm, z: parseInt(e.target.value) || 0 })} />
                          </div>
                        </td>
                        <td className="px-2 py-2">
                          <input className="w-full border rounded px-2 py-1 text-sm" value={editForm.description} onChange={e => setEditForm({ ...editForm, description: e.target.value })} />
                        </td>
                        <td className="px-4 py-2 text-right">
                          <button className="text-blue-500 hover:text-blue-700 text-xs mr-2" onClick={() => handleUpdate(wp.id)}>保存</button>
                          <button className="text-gray-500 hover:text-gray-700 text-xs" onClick={cancelEdit}>取消</button>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-4 py-2 font-medium text-gray-700">{wp.name}</td>
                        <td className="px-2 py-2 text-gray-500 text-xs font-mono">{wp.x}, {wp.y}, {wp.z}</td>
                        <td className="px-2 py-2 text-gray-400 text-xs max-w-[200px] truncate">{wp.description || '-'}</td>
                        <td className="px-4 py-2 text-right">
                          <button className="text-blue-500 hover:text-blue-700 text-xs mr-2" onClick={() => startEdit(wp)}>编辑</button>
                          <button className="text-red-500 hover:text-red-700 text-xs" onClick={() => handleDelete(wp.id)}>删除</button>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* 错误提示 */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded text-sm">
          {error}
          <button className="ml-2 underline" onClick={() => setError(null)}>关闭</button>
        </div>
      )}

      {/* 加载状态 */}
      {loading ? (
        <div className="text-center py-8 text-gray-400">加载中...</div>
      ) : (
        <div className="space-y-4">
          {DIMENSIONS.map(dim => renderTable(dim))}
        </div>
      )}
    </div>
  )
}

export default MapsView