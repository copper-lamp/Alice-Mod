/**
 * MapsView — 地图路径点管理 UI（v2.0 新增）
 *
 * 支持查看、创建、编辑、删除路径点。
 * 路径点格式：{dimension, x, y, z, name, description?, tags}
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
  { value: 'overworld', label: '主世界' },
  { value: 'nether', label: '下界' },
  { value: 'the_end', label: '末地' },
]

const MapsView: React.FC = () => {
  const [waypoints, setWaypoints] = useState<WaypointItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [keyword, setKeyword] = useState('')
  const [dimension, setDimension] = useState('')
  const [selectedWp, setSelectedWp] = useState<WaypointItem | null>(null)

  const loadWaypoints = useCallback(async (kw?: string, dim?: string) => {
    setLoading(true)
    setError(null)
    try {
      const params: any = { limit: 50 }
      if (kw) params.keywords = [kw]
      if (dim) params.dimension = dim
      const result = await mapsApi.list(params)
      setWaypoints(result.waypoints ?? [])
    } catch (err) {
      setError(`加载失败: ${(err as Error).message}`)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadWaypoints()
  }, [loadWaypoints])

  const handleSearch = () => {
    loadWaypoints(keyword || undefined, dimension || undefined)
  }

  const handleDelete = async (id: string) => {
    try {
      await mapsApi.delete(id)
      await loadWaypoints()
    } catch (err) {
      setError(`删除失败: ${(err as Error).message}`)
    }
  }

  const getDimensionLabel = (dim: string) => {
    const map: Record<string, string> = { overworld: '主世界', nether: '下界', the_end: '末地' }
    return map[dim] ?? dim
  }

  return (
    <div className="flex flex-col gap-4">
      {/* 搜索栏 */}
      <div className="flex items-center gap-2">
        <input
          placeholder="关键词搜索..."
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          className="flex-1 border rounded px-2 py-1 text-sm"
        />
        <select
          className="border rounded px-2 py-1 text-sm"
          value={dimension}
          onChange={(e) => setDimension(e.target.value)}
        >
          <option value="">全部维度</option>
          {DIMENSIONS.map(d => (
            <option key={d.value} value={d.value}>{d.label}</option>
          ))}
        </select>
        <button
          className="bg-blue-500 text-white text-sm px-3 py-1 rounded hover:bg-blue-600"
          onClick={handleSearch}
        >
          搜索
        </button>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded text-sm">
          {error}
          <button className="ml-2 underline" onClick={() => setError(null)}>关闭</button>
        </div>
      )}

      {/* 路径点列表 */}
      {loading ? (
        <div className="text-center py-8 text-gray-400">加载中...</div>
      ) : waypoints.length === 0 ? (
        <div className="text-center py-8 text-gray-400">暂无路径点</div>
      ) : (
        <div className="space-y-2">
          {waypoints.map(wp => (
            <div
              key={wp.id}
              className="border rounded-lg p-3 hover:shadow-sm transition-shadow cursor-pointer"
              onClick={() => setSelectedWp(selectedWp?.id === wp.id ? null : wp)}
            >
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full">
                    {getDimensionLabel(wp.dimension)}
                  </span>
                  <span className="font-medium text-sm">{wp.name}</span>
                  <span className="text-xs text-gray-400">
                    ({wp.x}, {wp.y}, {wp.z})
                  </span>
                </div>
                <button
                  className="text-xs text-red-500 hover:text-red-700"
                  onClick={(e) => { e.stopPropagation(); handleDelete(wp.id) }}
                >
                  删除
                </button>
              </div>
              {selectedWp?.id === wp.id && wp.description && (
                <div className="mt-2 text-sm text-gray-600">{wp.description}</div>
              )}
              {wp.tags.length > 0 && (
                <div className="flex gap-1 mt-1">
                  {wp.tags.map(tag => (
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

export default MapsView