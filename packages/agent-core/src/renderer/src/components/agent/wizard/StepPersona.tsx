import React, { useState } from 'react'
import { RadioGroup, Radio } from '@heroui/react'
import { useWizardStore } from '../../../stores/wizardStore'
import StepPersonaPreset from './StepPersonaPreset'
import StepPersonaAdvanced from './StepPersonaAdvanced'

const StepPersona: React.FC = () => {
  const { formData, updateFormData, updatePersona } = useWizardStore()
  const [mode, setMode] = useState<'preset' | 'advanced'>(formData.personaMode)

  const handleModeChange = (newMode: 'preset' | 'advanced') => {
    if (newMode === 'preset' && mode === 'advanced' && formData.persona.identity) {
      const confirmed = confirm('切换将丢失自定义内容，确认？')
      if (!confirmed) return
    }
    setMode(newMode)
    updateFormData({ personaMode: newMode })
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-gray-800 mb-1">人设配置</h3>
        <p className="text-xs text-gray-400 mb-2">选择预设或自定义智能体人设</p>
      </div>

      <RadioGroup
        value={mode}
        onChange={(val) => handleModeChange(val as 'preset' | 'advanced')}
        orientation="horizontal"
      >
        <Radio value="preset">使用预设</Radio>
        <Radio value="advanced">高级自定义</Radio>
      </RadioGroup>

      {mode === 'preset' ? <StepPersonaPreset /> : <StepPersonaAdvanced />}
    </div>
  )
}

export default StepPersona
