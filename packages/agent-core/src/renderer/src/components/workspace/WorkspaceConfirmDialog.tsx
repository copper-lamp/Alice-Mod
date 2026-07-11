import React, { useState } from 'react'
import { toast } from '@heroui/react'
import { Pickaxe, Leaf, AlertTriangle } from 'lucide-react'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { workspaceApi } from '../../lib/ipc'

const editionIcons: Record<string, React.ReactNode> = {
  bedrock: <Pickaxe size={28} />,
  java: <Leaf size={28} />,
}

const WorkspaceConfirmDialog: React.FC = () => {
  const {
    pendingValidation,
    confirmCreate,
    cancelCreate,
  } = useWorkspaceStore()

  const [name, setName] = useState(pendingValidation?.name ?? '')
  const [iconData, setIconData] = useState<string | undefined>(undefined)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!pendingValidation) return null

  const { edition, filePath, isDuplicate, duplicateName } = pendingValidation
  const defaultIcon = editionIcons[edition] ?? <Pickaxe size={28} />

  const handleSelectIcon = async () => {
    const result = await workspaceApi.selectIcon()
    if (result.iconData) {
      setIconData(result.iconData)
      toast.success('图标已更新')
    } else if (result.error) {
      toast.danger('选择图标失败: ' + result.error)
    }
  }

  const handleConfirm = async () => {
    if (!name.trim()) {
      setError('名称不能为空')
      return
    }

    setSaving(true)
    setError(null)

    try {
      await confirmCreate(name.trim(), iconData)
      toast.success(`工作区 "${name.trim()}" 创建成功`)
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败')
    }

    setSaving(false)
  }

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      cancelCreate()
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/20"
      onClick={handleBackdropClick}
    >
      <div className="bg-white rounded-xl shadow-2xl border border-gray-200 w-[420px] overflow-hidden">
        {/* 头部 */}
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-700">确认创建</h2>
        </div>

        {/* 内容 */}
        <div className="p-5 space-y-4">
          {/* 图标 + 名称 */}
          <div className="flex items-center gap-4">
            <button
              onClick={handleSelectIcon}
              className="w-12 h-12 rounded-lg bg-gray-100 flex items-center justify-center text-gray-600 flex-shrink-0 hover:bg-gray-200 transition-colors overflow-hidden"
              title="点击更换图标"
            >
              {iconData ? (
                <img src={iconData} alt="" className="w-full h-full object-cover" />
              ) : (
                defaultIcon
              )}
            </button>
            <div className="flex-1">
              <label className="block text-xs text-gray-500 mb-1">实例名称</label>
              <input
                className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:border-blue-400 focus:outline-none"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="请输入实例名称"
              />
            </div>
          </div>

          {/* 文件路径 */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">配置文件</label>
            <div className="px-3 py-1.5 text-xs text-gray-400 bg-gray-50 rounded-lg truncate" title={filePath}>
              {filePath}
            </div>
          </div>

          {/* 重复警告 */}
          {isDuplicate && (
            <div className="flex items-start gap-2 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-xs text-yellow-700">
              <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
              <span>
                实例 <strong>{duplicateName || name}</strong> 已存在，确认后将覆盖更新。
              </span>
            </div>
          )}

          {/* 错误提示 */}
          {error && (
            <div className="p-2.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-600">
              {error}
            </div>
          )}
        </div>

        {/* 底部按钮 */}
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-100 bg-gray-50">
          <button
            onClick={cancelCreate}
            className="px-4 py-1.5 text-xs font-medium text-gray-500 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleConfirm}
            disabled={saving || !name.trim()}
            className="px-4 py-1.5 text-xs font-medium text-white bg-blue-500 rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50"
          >
            {saving ? '创建中...' : '确认创建'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default WorkspaceConfirmDialog
