import React, { useEffect, useState, useCallback } from 'react'
import { Checkbox, Tooltip, Button } from '@heroui/react'
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
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set())

  useEffect(() => {
    loadTools()
  }, [])

  const loadTools = async () => {
    try {
      const result = await window.electronAPI.invoke('tool:list-all') as ToolItem[]
      setTools(result)
      if (Object.keys(formData.enabledTools).length === 0) {
        const enabled: Record<string, boolean> = {}
        result.forEach(t => { enabled[t.name] = true })
        setEnabledTools(enabled)
      }
    } catch (err) {
      console.error('加载工具列表失败:', err)
    } finally {
      setLoading(false)
    }
  }

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

  const handleDebugPrompt = useCallback(async () => {
    const { formData } = useWizardStore.getState()
    try {
      const result = await window.electronAPI.invoke('debug:assemble-prompt', {
        name: formData.name,
        identity: formData.persona.identity,
        expertise: formData.persona.expertise,
        personality: formData.persona.personality,
        workflowId: formData.persona.workflowId,
        enabledTools: formData.enabledTools,
        behaviorRules: formData.persona.behaviorRules,
        communicationStyle: formData.persona.communicationStyle,
        boundaries: formData.persona.boundaries,
      }) as { success: boolean; prompt: string }
      if (result.success) {
        console.log('[调试] 提示词组装结果:\n' + result.prompt)
      }
    } catch (err) {
      console.error('[调试] 提示词组装失败:', err)
    }
  }, [])

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
          <Button size="sm" variant="ghost" onPress={handleDebugPrompt}>
            🛠 组装提示词
          </Button>
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
                  <Checkbox
                    isSelected={!!formData.enabledTools[tool.name]}
                    onChange={() => toggleTool(tool.name)}
                  />
                  <Tooltip
                    content={
                      <div className="max-w-xs space-y-1">
                        <p className="font-medium text-sm">{tool.displayName} ({tool.name})</p>
                        <p className="text-xs text-gray-300">{tool.description}</p>
                        {tool.parameters.length > 0 && (
                          <>
                            <p className="text-xs text-gray-400 mt-1">参数:</p>
                            {tool.parameters.map(p => (
                              <p key={p.name} className="text-xs text-gray-300">
                                {p.name}: {p.type} {p.required ? '(必填)' : '(可选)'}
                              </p>
                            ))}
                          </>
                        )}
                        {tool.example && (
                          <p className="text-xs text-gray-400 mt-1">示例: {tool.example}</p>
                        )}
                      </div>
                    }
                    placement="right"
                  >
                    <span className="text-sm text-gray-700 cursor-help hover:text-blue-600 transition-colors">
                      {tool.displayName}
                    </span>
                  </Tooltip>
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
