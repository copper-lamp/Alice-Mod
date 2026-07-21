import React, { useEffect, useState, useCallback } from 'react'
import { Switch } from '@heroui/react'
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

const StepTools: React.FC = () => {
  const { formData, setEnabledTools } = useWizardStore()
  const [tools, setTools] = useState<ToolItem[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set())

  useEffect(() => {
    loadTools()
    // 监听工具列表更新事件，自动刷新
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
      // 只在非刷新模式下保留已有的 enabledTools 选择状态
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

  const grouped = tools.reduce<Record<string, ToolItem[]>>((acc, tool) => {
    if (!acc[tool.category]) acc[tool.category] = []
    acc[tool.category].push(tool)
    return acc
  }, {})

  const enabledCount = Object.values(formData.enabledTools).filter(Boolean).length
  const totalCount = tools.length

  const toggleTool = (toolName: string) => {
    setEnabledTools({
      ...formData.enabledTools,
      [toolName]: !formData.enabledTools[toolName],
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
      <div className="flex items-center justify-between">
        <span className="text-sm text-gray-500">
          已启用: <strong className="text-gray-700">{enabledCount}</strong>/{totalCount}
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => loadTools(true)}
            disabled={refreshing}
            className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-blue-600 disabled:opacity-50 transition-colors"
            title="重新加载工具列表"
          >
            <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
            {refreshing ? '刷新中...' : '刷新'}
          </button>
          <button onClick={toggleAll} className="text-xs text-blue-600 hover:text-blue-700">
            {enabledCount === totalCount ? '取消全选' : '全选'}
          </button>
        </div>
      </div>

      {Object.entries(grouped).map(([category, categoryTools]) => (
        <div key={category} className="border border-gray-200 rounded-lg overflow-hidden">
          <button
            onClick={() => {
              const next = new Set(collapsedCategories)
              if (next.has(category)) next.delete(category)
              else next.add(category)
              setCollapsedCategories(next)
            }}
            className="w-full flex items-center justify-between px-4 py-2.5 bg-gray-50 hover:bg-gray-100 transition-colors"
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
                <div key={tool.name} className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50/50">
                  <div className="flex items-center justify-center shrink-0 overflow-hidden" style={{ width: 40, height: 24 }}>
                    <Switch
                      isSelected={!!formData.enabledTools[tool.name]}
                      onChange={(val) => {
                        setEnabledTools({
                          ...formData.enabledTools,
                          [tool.name]: val,
                        })
                      }}
                      size="sm"
                    >
                      <Switch.Content>
                        <Switch.Control>
                          <Switch.Thumb />
                        </Switch.Control>
                      </Switch.Content>
                    </Switch>
                  </div>
                  <span
                    className="text-sm text-gray-700 cursor-help hover:text-blue-600 transition-colors"
                    title={`${tool.displayName} (${tool.name}) - ${tool.description}${tool.parameters.length > 0 ? `\n参数: ${tool.parameters.map(p => `${p.name}: ${p.type}${p.required ? '(必填)' : '(可选)'}`).join(', ')}` : ''}${tool.example ? `\n示例: ${tool.example}` : ''}`}
                  >
                    {tool.displayName}
                  </span>
                  <span className="text-xs text-gray-400 ml-auto">{tool.categoryLabel}</span>
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
