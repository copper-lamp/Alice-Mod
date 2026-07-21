import React, { useEffect, useState, useCallback } from 'react'
import { RefreshCw } from 'lucide-react'
import { useWizardStore } from '../../../stores/wizardStore'

interface ToolItem {
  name: string
  displayName: string
  description: string
  category: string
  categoryLabel: string
  parameters: Array<{ name: string; type: string; description: string; required: boolean }>
  example?: string
}

/**
 * 自定义开关组件 - 替代 HeroUI Switch
 * 使用原生 button，避免 HeroUI 内部 focus 行为导致页面滚动偏移
 */
interface ToggleProps {
  checked: boolean
  onChange: (val: boolean) => void
  label?: string
}

const Toggle: React.FC<ToggleProps> = ({ checked, onChange, label }) => {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className="relative inline-flex items-center w-9 h-5 rounded-full transition-colors duration-200 shrink-0 outline-none focus:outline-none"
      style={{
        backgroundColor: checked ? '#3b82f6' : '#d1d5db',
      }}
    >
      <span
        className="inline-block w-4 h-4 bg-white rounded-full shadow transition-transform duration-200"
        style={{
          transform: checked ? 'translateX(18px)' : 'translateX(2px)',
        }}
      />
    </button>
  )
}

const ROW_HEIGHT = 44
const HEADER_HEIGHT = 40

const StepTools: React.FC = () => {
  const { formData, setEnabledTools } = useWizardStore()
  const [tools, setTools] = useState<ToolItem[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set())

  useEffect(() => {
    loadTools()
    if (window.electronAPI) {
      const unsubscribe = window.electronAPI.on('workspace:tools-updated', () => {
        loadTools(true)
      })
      return () => { unsubscribe() }
    }
  }, [])

  const loadTools = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    try {
      const result = await window.electronAPI.invoke('tool:list-all') as ToolItem[]
      if (!isRefresh && Object.keys(formData.enabledTools).length === 0) {
        const enabled: Record<string, boolean> = {}
        result.forEach(t => { enabled[t.name] = true })
        setEnabledTools(enabled)
      }
      setTools(result)
    } catch (err) {
      console.error('加载工具列表失败:', err)
    } finally {
      setLoading(false)
      if (isRefresh) setRefreshing(false)
    }
  }, [formData.enabledTools, setEnabledTools])

  // 按分类分组并固定顺序，避免重新渲染时顺序变化
  const grouped = React.useMemo(() => {
    const acc: Record<string, ToolItem[]> = {}
    tools.forEach(tool => {
      if (!acc[tool.category]) acc[tool.category] = []
      acc[tool.category].push(tool)
    })
    return acc
  }, [tools])

  const enabledCount = Object.values(formData.enabledTools).filter(Boolean).length
  const totalCount = tools.length

  const toggleTool = (toolName: string, val: boolean) => {
    setEnabledTools({
      ...formData.enabledTools,
      [toolName]: val,
    })
  }

  const toggleAll = () => {
    const allEnabled = enabledCount === totalCount
    const newEnabled: Record<string, boolean> = {}
    tools.forEach(t => { newEnabled[t.name] = !allEnabled })
    setEnabledTools(newEnabled)
  }

  if (loading) {
    return <div className="text-sm text-gray-400 text-center py-8">加载工具列表...</div>
  }

  if (tools.length === 0) {
    return (
      <div className="text-sm text-gray-400 text-center py-8">
        暂无已注册工具，请先连接 Adapter Core
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* 顶部统计栏 - 固定高度防止偏移 */}
      <div
        className="flex items-center justify-between px-1"
        style={{ height: HEADER_HEIGHT }}
      >
        <span className="text-sm text-gray-500">
          已启用: <strong className="text-gray-700">{enabledCount}</strong>/{totalCount}
        </span>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => loadTools(true)}
            disabled={refreshing}
            className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-blue-600 disabled:opacity-50 transition-colors"
          >
            <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
            {refreshing ? '刷新中...' : '刷新'}
          </button>
          <button
            type="button"
            onClick={toggleAll}
            className="text-xs text-blue-600 hover:text-blue-700"
          >
            {enabledCount === totalCount ? '取消全选' : '全选'}
          </button>
        </div>
      </div>

      {/* 工具分类列表 */}
      {Object.entries(grouped).map(([category, categoryTools]) => (
        <div key={category} className="border border-gray-200 rounded-lg overflow-hidden">
          {/* 分类标题 - 固定高度 */}
          <button
            type="button"
            onClick={() => {
              setCollapsedCategories(prev => {
                const next = new Set(prev)
                if (next.has(category)) next.delete(category)
                else next.add(category)
                return next
              })
            }}
            className="w-full flex items-center justify-between px-4 bg-gray-50 hover:bg-gray-100 transition-colors"
            style={{ height: HEADER_HEIGHT }}
          >
            <span className="text-sm font-medium text-gray-700">
              {categoryTools[0]?.categoryLabel || category}
              <span className="text-xs text-gray-400 ml-2">({categoryTools.length})</span>
            </span>
            <span className="text-gray-400 text-xs">
              {collapsedCategories.has(category) ? '展开' : '收起'}
            </span>
          </button>

          {!collapsedCategories.has(category) && (
            <div className="divide-y divide-gray-100">
              {categoryTools.map(tool => (
                <div
                  key={tool.name}
                  className="flex items-center gap-3 px-4 hover:bg-gray-50/50"
                  style={{ height: ROW_HEIGHT }}
                >
                  {/* 自定义开关 - 固定宽高，无 focus 滚动副作用 */}
                  <Toggle
                    checked={!!formData.enabledTools[tool.name]}
                    onChange={(val) => toggleTool(tool.name, val)}
                    label={tool.displayName}
                  />

                  {/* 工具名称 - 原生 title 显示详情 */}
                  <span
                    className="text-sm text-gray-700 cursor-help hover:text-blue-600 transition-colors truncate"
                    title={`${tool.displayName} (${tool.name})\n${tool.description}${tool.parameters.length > 0 ? `\n参数: ${tool.parameters.map(p => `${p.name}: ${p.type}${p.required ? '(必填)' : '(可选)'}`).join(', ')}` : ''}${tool.example ? `\n示例: ${tool.example}` : ''}`}
                  >
                    {tool.displayName}
                  </span>

                  {/* 分类标签 - 右对齐 */}
                  <span className="text-xs text-gray-400 ml-auto shrink-0">
                    {tool.categoryLabel}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

export default StepTools
