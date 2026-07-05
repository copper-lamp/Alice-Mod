import React from 'react'
import { Checkbox, TextArea } from '@heroui/react'

interface IdentitySectionProps {
  selectedFragments: string[]
  customPrompt?: string
  onChange: (identity: { selectedFragments: string[]; customPrompt?: string }) => void
}

const PRESET_FRAGMENTS = [
  { id: 'miner', label: '采矿专家' },
  { id: 'builder', label: '建筑师' },
  { id: 'fighter', label: '战斗专家' },
  { id: 'redstone', label: '红石工程师' }
]

const IdentitySection: React.FC<IdentitySectionProps> = ({ selectedFragments, customPrompt, onChange }) => {
  const toggleFragment = (fragmentId: string) => {
    const updated = selectedFragments.includes(fragmentId)
      ? selectedFragments.filter(id => id !== fragmentId)
      : [...selectedFragments, fragmentId]
    onChange({ selectedFragments: updated, customPrompt })
  }

  const handleCustomPromptChange = (value: string) => {
    onChange({ selectedFragments, customPrompt: value })
  }

  return (
    <div className="space-y-4">
      {/* 已选片段标签 */}
      {selectedFragments.length > 0 && (
        <div>
          <label className="text-xs text-gray-500 font-medium mb-1.5 block">已选身份片段</label>
          <div className="flex flex-wrap gap-1.5">
            {selectedFragments.map(id => {
              const fragment = PRESET_FRAGMENTS.find(f => f.id === id)
              if (!fragment) return null
              return (
                <span
                  key={id}
                  className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-blue-50 text-blue-600 rounded-full border border-blue-200"
                >
                  {fragment.label}
                  <button
                    onClick={() => toggleFragment(id)}
                    className="text-blue-400 hover:text-blue-600 ml-0.5"
                  >
                    ×
                  </button>
                </span>
              )
            })}
          </div>
        </div>
      )}

      {/* 预设列表 */}
      <div>
        <label className="text-xs text-gray-500 font-medium mb-1.5 block">预设身份片段</label>
        <div className="space-y-1">
          {PRESET_FRAGMENTS.map(fragment => (
            <Checkbox
              key={fragment.id}
              isSelected={selectedFragments.includes(fragment.id)}
              onChange={() => toggleFragment(fragment.id)}
            >
              <Checkbox.Content>
                <Checkbox.Control>
                  <Checkbox.Indicator />
                </Checkbox.Control>
                {fragment.label}
              </Checkbox.Content>
            </Checkbox>
          ))}
        </div>
      </div>

      {/* 自定义提示词 */}
      <div>
        <label className="text-xs text-gray-500 font-medium mb-1.5 block">自定义提示词</label>
        <TextArea
          value={customPrompt ?? ''}
          onChange={(e) => handleCustomPromptChange(e.target.value)}
          placeholder="输入自定义提示词，覆盖预设片段的默认行为..."
          rows={3}
          className="w-full resize-none"
        />
      </div>
    </div>
  )
}

export default IdentitySection
