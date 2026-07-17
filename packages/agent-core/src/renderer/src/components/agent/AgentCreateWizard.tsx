import React, { useCallback } from 'react'
import { Button } from '@heroui/react'
import { useWizardStore } from '../../stores/wizardStore'
import { useUIStore } from '../../stores/uiStore'
import { useAgentStore } from '../../stores/agentStore'
import StepIndicator from './wizard/StepIndicator'
import StepBasicInfo from './wizard/StepBasicInfo'
import StepPersona from './wizard/StepPersona'
import StepTools from './wizard/StepTools'
import StepRobot from './wizard/StepRobot'
import StepLLM from './wizard/StepLLM'

const STEPS = ['基本信息', '人设', '工具', '机器人', 'LLM'] as const

function checkStepValid(step: number): boolean {
  const { formData } = useWizardStore.getState()
  switch (step) {
    case 0: return formData.name.trim().length > 0
    case 1: return formData.persona.identity.trim().length > 0
    case 2: return Object.keys(formData.enabledTools).length > 0
    case 3: return true
    case 4: return !!formData.llmConfig.mainModel.modelId
    default: return false
  }
}

const AgentCreateWizard: React.FC = () => {
  const { currentStep, completedSteps, submitting, nextStep, prevStep, goToStep, submit } = useWizardStore()
  const { navigateToAgent } = useUIStore()

  const handleSubmit = useCallback(async () => {
    const agentId = await submit()
    if (agentId) {
      // 创建成功后刷新智能体列表，确保侧边栏立即显示新智能体
      useAgentStore.getState().refreshAgents()
      navigateToAgent(agentId)
    }
  }, [submit, navigateToAgent])

  const renderStep = () => {
    switch (currentStep) {
      case 0: return <StepBasicInfo />
      case 1: return <StepPersona />
      case 2: return <StepTools />
      case 3: return <StepRobot />
      case 4: return <StepLLM />
      default: return null
    }
  }

  const isLastStep = currentStep === STEPS.length - 1
  const canProceed = checkStepValid(currentStep)

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <StepIndicator steps={STEPS} currentStep={currentStep} completedSteps={completedSteps} onStepClick={goToStep} />

      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-3xl mx-auto">
          {renderStep()}
        </div>
      </div>

      <div className="shrink-0 px-6 py-4 border-t border-gray-100 bg-white flex items-center justify-between">
        <Button size="sm" variant="ghost" isDisabled={currentStep === 0} onPress={prevStep}>
          上一步
        </Button>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" onPress={() => {
            if (confirm('当前配置未保存，确认离开？')) {
              useUIStore.getState().setLayoutMode('nav-view')
            }
          }}>
            取消
          </Button>
          {isLastStep ? (
            <Button size="sm" variant="primary" isDisabled={submitting || !canProceed} isPending={submitting} onPress={handleSubmit}>
              {submitting ? '创建中...' : '确定'}
            </Button>
          ) : (
            <Button size="sm" variant="primary" isDisabled={!canProceed} onPress={nextStep}>
              下一步
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

export default AgentCreateWizard