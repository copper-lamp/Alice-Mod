import React, { useEffect, useState } from 'react'
import { Button } from '@heroui/react'
import { useWizardStore } from '../../../stores/wizardStore'

interface PersonalityTrait {
  id: string
  description: string
  tags: string[]
}

interface PersonalityCategory {
  category: string
  traits: PersonalityTrait[]
}

const WORKFLOWS = [
  { id: 'explore_gather', name: '探索采集循环', desc: '探索区域、采集资源' },
  { id: 'combat_loot', name: '战斗搜刮循环', desc: '战斗、搜刮战利品' },
  { id: 'build_construct', name: '建造施工循环', desc: '规划设计、施工建造' },
  { id: 'guard_patrol', name: '守卫巡逻循环', desc: '巡逻基地、清除威胁' },
  { id: 'farm_harvest', name: '农耕养殖循环', desc: '种植作物、养殖动物' },
  { id: 'mine_quarry', name: '采矿冶炼循环', desc: '挖掘矿石、冶炼加工' },
  { id: 'trade_barter', name: '交易补给循环', desc: '与村民交易、物资补给' },
]

const EXPERTISE_OPTIONS = [
  '采矿专家', '资源管理', '红石工程', '建筑大师',
  '战斗专精', '探索向导', '农业专家', '交易达人',
  '附魔师', '药剂师', '驯兽师', '钓鱼高手',
]

const StepPersonaAdvanced: React.FC = () => {
  const { formData, updatePersona } = useWizardStore()
  const [personalityCategories, setPersonalityCategories] = useState<PersonalityCategory[]>([])
  const [presetName, setPresetName] = useState('')

  useEffect(() => {
    loadPersonalities()
  }, [])

  const loadPersonalities = async () => {
    try {
      const result = await window.electronAPI.invoke('template:list-personality-categories') as PersonalityCategory[]
      setPersonalityCategories(result)
    } catch {
      // 忽略
    }
  }

  const toggleExpertise = (tag: string) => {
    const current = formData.persona.expertise
    const next = current.includes(tag)
      ? current.filter(t => t !== tag)
      : [...current, tag]
    updatePersona({ expertise: next })
  }

  const togglePersonality = (traitId: string) => {
    const current = formData.persona.personality
    const next = current.includes(traitId)
      ? current.filter(id => id !== traitId)
      : [...current, traitId]
    updatePersona({ personality: next })
  }

  const handleSavePreset = async () => {
    if (!presetName.trim()) return
    try {
      await window.electronAPI.invoke('preset:create', {
        name: presetName,
        description: `自定义预设：${presetName}`,
        identity: formData.persona.identity,
        expertise: formData.persona.expertise,
        personality: formData.persona.personality,
        workflowId: formData.persona.workflowId,
        behaviorRules: formData.persona.behaviorRules ?? { core: [], strategy: [], constraints: [] },
        recommendedToolCategories: formData.persona.expertise,
      })
      setPresetName('')
      alert('预设保存成功！')
    } catch {
      alert('保存失败')
    }
  }

  return (
    <div className="space-y-6">
      {/* 身份设定 */}
      <div className="p-4 bg-white rounded-lg border border-gray-200">
        <h4 className="text-sm font-medium text-gray-700 mb-2">身份设定</h4>
        <textarea
          value={formData.persona.identity}
          onChange={(e) => updatePersona({ identity: e.target.value })}
          placeholder="描述智能体的身份、背景和核心职责..."
          rows={4}
          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-blue-300 resize-none"
        />
      </div>

      {/* 专业设定 */}
      <div className="p-4 bg-white rounded-lg border border-gray-200">
        <h4 className="text-sm font-medium text-gray-700 mb-2">专业设定</h4>
        <div className="flex flex-wrap gap-1.5">
          {EXPERTISE_OPTIONS.map(tag => (
            <button
              key={tag}
              onClick={() => toggleExpertise(tag)}
              className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                formData.persona.expertise.includes(tag)
                  ? 'bg-blue-50 text-blue-600 border-blue-200'
                  : 'bg-gray-50 text-gray-500 border-gray-200 hover:border-gray-300'
              }`}
            >
              {tag}
            </button>
          ))}
        </div>
      </div>

      {/* 性格 */}
      <div className="p-4 bg-white rounded-lg border border-gray-200">
        <h4 className="text-sm font-medium text-gray-700 mb-2">性格</h4>
        <div className="space-y-3">
          {personalityCategories.map(cat => (
            <div key={cat.category}>
              <p className="text-xs text-gray-400 mb-1">{cat.category}</p>
              <div className="flex flex-wrap gap-1.5">
                {cat.traits.map(trait => (
                  <button
                    key={trait.id}
                    onClick={() => togglePersonality(trait.id)}
                    className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                      formData.persona.personality.includes(trait.id)
                        ? 'bg-green-50 text-green-600 border-green-200'
                        : 'bg-gray-50 text-gray-500 border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    {trait.description}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 工作流设定 */}
      <div className="p-4 bg-white rounded-lg border border-gray-200">
        <h4 className="text-sm font-medium text-gray-700 mb-2">工作流设定</h4>
        <div className="space-y-1.5">
          {WORKFLOWS.map(wf => (
            <button
              key={wf.id}
              onClick={() => updatePersona({ workflowId: wf.id })}
              className={`w-full text-left px-3 py-2 rounded-lg border text-sm transition-colors ${
                formData.persona.workflowId === wf.id
                  ? 'border-blue-300 bg-blue-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <span className="font-medium text-gray-700">{wf.name}</span>
              <span className="text-xs text-gray-400 ml-2">{wf.desc}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 沟通风格 */}
      <div className="p-4 bg-white rounded-lg border border-gray-200">
        <h4 className="text-sm font-medium text-gray-700 mb-2">沟通风格（可选）</h4>
        <textarea
          value={(formData.persona.communicationStyle ?? []).join('\n')}
          onChange={(e) => updatePersona({ communicationStyle: e.target.value.split('\n').filter(s => s.trim()) })}
          placeholder="描述智能体的沟通方式，如：&#10;简洁直接，先说结论再说细节&#10;汇报时先说成果再说过程&#10;遇到问题时说明现象、原因和解决方案"
          rows={4}
          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-blue-300 resize-none"
        />
        <p className="text-xs text-gray-400 mt-1">每行一条规则，留空则使用身份模板默认风格</p>
      </div>

      {/* 行为边界 */}
      <div className="p-4 bg-white rounded-lg border border-gray-200">
        <h4 className="text-sm font-medium text-gray-700 mb-2">行为边界（可选）</h4>
        <textarea
          value={(formData.persona.boundaries ?? []).join('\n')}
          onChange={(e) => updatePersona({ boundaries: e.target.value.split('\n').filter(s => s.trim()) })}
          placeholder="描述智能体的行为限制，如：&#10;不攻击友好生物&#10;生命值低于 5 时撤退&#10;不进入明显致命的区域"
          rows={4}
          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-blue-300 resize-none"
        />
        <p className="text-xs text-gray-400 mt-1">每行一条规则，留空则使用身份模板默认边界</p>
      </div>

      {/* 保存为预设 */}
      <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
        <h4 className="text-sm font-medium text-gray-700 mb-2">保存为预设</h4>
        <div className="flex gap-2">
          <input
            type="text"
            value={presetName}
            onChange={(e) => setPresetName(e.target.value)}
            placeholder="请输入预设名称..."
            className="flex-1 px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-blue-300"
          />
          <Button size="sm" variant="primary" isDisabled={!presetName.trim()} onPress={handleSavePreset}>
            保存
          </Button>
        </div>
      </div>
    </div>
  )
}

export default StepPersonaAdvanced
