import React, { useEffect, useState } from 'react'
import { useWizardStore } from '../../../stores/wizardStore'

interface IdentityTemplate {
  id: string
  name: string
  description: string
  identity: string
  personality: string[]
  recommendedToolCategories: string[]
  recommendedWorkflow?: string
  rules: {
    core: string[]
    strategy: Array<{ name: string; description: string; priority: number }>
    constraints: Array<{ name: string; description: string; consequence: string }>
  }
}

const StepPersonaPreset: React.FC = () => {
  const { formData, updateFormData, updatePersona } = useWizardStore()
  const [presets, setPresets] = useState<IdentityTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    loadPresets()
  }, [])

  const loadPresets = async () => {
    try {
      const result = await window.electronAPI.invoke('template:list-identities') as IdentityTemplate[]
      setPresets(result)
      // 默认选中第一个
      if (result.length > 0 && !formData.personaPresetId) {
        selectPreset(result[0])
      }
    } catch {
      // 忽略
    } finally {
      setLoading(false)
    }
  }

  const selectPreset = (preset: IdentityTemplate) => {
    updateFormData({
      personaPresetId: preset.id,
    })
    updatePersona({
      identity: preset.identity,
      personality: preset.personality,
      workflowId: preset.recommendedWorkflow ?? 'explore_gather',
      expertise: preset.recommendedToolCategories,
      behaviorRules: {
        core: preset.rules.core,
        strategy: preset.rules.strategy,
        constraints: preset.rules.constraints as Array<{ name: string; description: string; consequence: 'warning' | 'block' | 'replan' }>,
      },
    })
  }

  const filtered = presets.filter(p =>
    p.name.includes(search) || p.description.includes(search)
  )

  if (loading) {
    return <div className="text-sm text-gray-400 text-center py-8">加载预设...</div>
  }

  return (
    <div className="space-y-3">
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="搜索预设..."
        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-blue-300"
      />

      <div className="space-y-2 max-h-96 overflow-y-auto">
        {filtered.map(p => (
          <button
            key={p.id}
            onClick={() => selectPreset(p)}
            className={`w-full text-left p-3 rounded-lg border transition-colors ${
              formData.personaPresetId === p.id
                ? 'border-blue-300 bg-blue-50'
                : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-medium text-gray-800">{p.name}</span>
              {formData.personaPresetId === p.id && (
                <span className="text-xs text-blue-600">✓ 已选</span>
              )}
            </div>
            <p className="text-xs text-gray-500 line-clamp-2">{p.description}</p>
            <div className="flex gap-1 mt-1.5 flex-wrap">
              {p.personality.slice(0, 3).map((trait: string) => (
                <span key={trait} className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded">
                  {trait}
                </span>
              ))}
              {p.personality.length > 3 && (
                <span className="text-[10px] text-gray-400">+{p.personality.length - 3}</span>
              )}
            </div>
          </button>
        ))}
        {filtered.length === 0 && (
          <div className="text-sm text-gray-400 text-center py-4">无匹配预设</div>
        )}
      </div>
    </div>
  )
}

export default StepPersonaPreset
