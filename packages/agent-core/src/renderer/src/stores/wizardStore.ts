import { create } from 'zustand'
import type { WizardFormData, AgentPersona, AgentLLMConfig, QQBinding } from '../lib/types'

interface WizardState {
  currentStep: number
  completedSteps: number[]
  formData: WizardFormData
  submitting: boolean

  goToStep: (step: number) => void
  nextStep: () => void
  prevStep: () => void
  updateFormData: (partial: Partial<WizardFormData>) => void
  updatePersona: (persona: Partial<AgentPersona>) => void
  updateLLMConfig: (config: Partial<AgentLLMConfig>) => void
  updateQQBinding: (binding: Partial<QQBinding>) => void
  setEnabledTools: (tools: Record<string, boolean>) => void
  submit: () => Promise<string | null>
  reset: () => void
}

const DEFAULT_FORM: WizardFormData = {
  name: '',
  alias: '',
  skinData: undefined,
  personaMode: 'preset',
  personaPresetId: undefined,
  persona: {
    identity: '',
    expertise: [],
    personality: [],
    workflowId: 'explore_gather',
  },
  enabledTools: {},
  qqBinding: { enabled: false, accountId: '', groupIds: [] },
  llmConfig: {
    mainModel: { providerId: '', modelId: '', modelName: '' },
    qqBotModel: { providerId: '', modelId: '', modelName: '', sameAsMain: true },
    compressionModel: { providerId: '', modelId: '', modelName: '', sameAsMain: true },
  },
}

export const useWizardStore = create<WizardState>((set, get) => ({
  currentStep: 0,
  completedSteps: [],
  formData: { ...DEFAULT_FORM },
  submitting: false,

  goToStep: (step) => {
    const { completedSteps, currentStep } = get()
    if (step <= currentStep || completedSteps.includes(step - 1)) {
      set({ currentStep: step })
    }
  },

  nextStep: () => {
    const { currentStep, completedSteps } = get()
    if (currentStep < 4) {
      const newCompleted = completedSteps.includes(currentStep)
        ? completedSteps
        : [...completedSteps, currentStep]
      set({ currentStep: currentStep + 1, completedSteps: newCompleted })
    }
  },

  prevStep: () => {
    const { currentStep } = get()
    if (currentStep > 0) set({ currentStep: currentStep - 1 })
  },

  updateFormData: (partial) => {
    set((state) => ({ formData: { ...state.formData, ...partial } }))
  },

  updatePersona: (persona) => {
    set((state) => ({
      formData: {
        ...state.formData,
        persona: { ...state.formData.persona, ...persona },
      },
    }))
  },

  updateLLMConfig: (config) => {
    set((state) => ({
      formData: {
        ...state.formData,
        llmConfig: { ...state.formData.llmConfig, ...config },
      },
    }))
  },

  updateQQBinding: (binding) => {
    set((state) => ({
      formData: {
        ...state.formData,
        qqBinding: { ...state.formData.qqBinding, ...binding },
      },
    }))
  },

  setEnabledTools: (tools) => {
    set((state) => ({
      formData: { ...state.formData, enabledTools: tools },
    }))
  },

  submit: async () => {
    set({ submitting: true })
    try {
      const { formData } = get()
      const agentConfig = {
        name: formData.name,
        alias: formData.alias || formData.name,
        skinData: formData.skinData,
        persona: formData.persona,
        personaPresetId: formData.personaMode === 'preset' ? formData.personaPresetId : undefined,
        tools: { enabledTools: formData.enabledTools },
        qqBinding: formData.qqBinding,
        llmConfig: formData.llmConfig,
      }
      const result = await window.electronAPI.invoke('agent:create', agentConfig) as { id: string; success: boolean }
      if (result.success) {
        get().reset()
        return result.id
      }
      return null
    } catch (err) {
      console.error('创建智能体失败:', err)
      return null
    } finally {
      set({ submitting: false })
    }
  },

  reset: () => {
    set({
      currentStep: 0,
      completedSteps: [],
      formData: { ...DEFAULT_FORM },
      submitting: false,
    })
  },
}))
