# Alice Mod Core V16 — 智能体创建向导 执行文档

> 版本：v1.0
> 日期：2026-07-15
> 版本号：V16
> 关联文档：[AC-V16-智能体创建向导-需求文档.md](AC-V16-智能体创建向导-需求文档.md)、[AC-V16-智能体创建向导-架构文档.md](AC-V16-智能体创建向导-架构文档.md)

---

## 第1章 前置条件

### 1.1 依赖检查

| 依赖项 | 说明 | 状态 |
|--------|------|:----:|
| V8 UI 骨架 | AppLayout、LeftSidebar、AgentCreatePage | ✅ 已有 |
| V8 IPC 通信 | window.electronAPI.invoke/on 机制 | ✅ 已有 |
| V8 agentStore | 智能体管理 Store | ✅ 已有 |
| V8 modelStore | 模型配置 Store | ✅ 已有 |
| V10 qqBotStore | QQ 机器人 Store | ✅ 已有 |
| V3 ToolRegistry | 工具注册管理器 | ✅ 已有 |
| V5 身份模板 | identity-templates.ts | ✅ 已有 |
| V5 性格库 | personality-library.ts | ✅ 已有 |
| V5 工作流模板 | workflow-templates.ts | ✅ 已有 |
| V5 行为预设 | behavior-presets.ts | ✅ 已有 |
| V2 DatabaseManager | SQLite 数据库管理 | ✅ 已有 |

### 1.2 需要安装的依赖

无新增依赖。所有 UI 组件使用已有的 @heroui/react。

---

## 第2章 开发顺序

### 阶段 1: 类型定义 + 数据库（1 天）

| 任务 | 文件 | 说明 |
|------|------|------|
| 1.1 新增类型定义 | `src/renderer/src/lib/types.ts` | 新增 PersonaPreset, AgentPersona, AgentLLMConfig, ModelSelection, ToolInfo, WizardFormData 等 |
| 1.2 修改 AgentConfig 类型 | `src/renderer/src/lib/types.ts` | 添加 alias, persona, personaPresetId, llmConfig 字段；修改 tools 结构 |
| 1.3 新增 SQLite 建表 | `src/main/database/schema.sql` | 添加 agents 表和 persona_presets 表 |
| 1.4 数据库初始化 | `src/main/database/database-manager.ts` | 确保新表在应用启动时自动创建 |

### 阶段 2: 后端业务层（2 天）

| 任务 | 文件 | 说明 |
|------|------|------|
| 2.1 重构 AgentConfigManager | `src/main/agent/agent-config-manager.ts` | 新建文件，SQLite 持久化实现 |
| 2.2 注册 AgentConfigManager | `src/main/ipc/agent-handler.ts` | 替换旧的 AgentConfigManager，更新 IPC Handler 实现 |
| 2.3 新建 PersonaPresetManager | `src/main/agent/persona-preset-manager.ts` | 新建文件，管理内置+自定义预设 |
| 2.4 新建 preset-handler | `src/main/ipc/preset-handler.ts` | preset CRUD IPC Handler |
| 2.5 新建 tool-handler | `src/main/ipc/tool-handler.ts` | 工具列表获取 + 中文翻译映射 |
| 2.6 更新 IPC 入口 | `src/main/ipc/index.ts` | 注册新的 IPC Handler |

### 阶段 3: 前端基础组件（3 天）

| 任务 | 文件 | 说明 |
|------|------|------|
| 3.1 新增 wizardStore | `src/renderer/src/stores/wizardStore.ts` | 向导状态管理 |
| 3.2 修改 agentStore | `src/renderer/src/stores/agentStore.ts` | 支持新 AgentConfig 数据结构 |
| 3.3 更新 ipc.ts | `src/renderer/src/lib/ipc.ts` | 新增 preset/tool API |
| 3.4 修改 AgentCreatePage | `src/renderer/src/components/agent/AgentCreatePage.tsx` | 包装 AgentCreateWizard |
| 3.5 新增 StepIndicator | `src/renderer/src/components/agent/wizard/StepIndicator.tsx` | 步骤指示器组件 |
| 3.6 新增 AgentCreateWizard | `src/renderer/src/components/agent/AgentCreateWizard.tsx` | 向导容器，步骤路由 |

### 阶段 4: 各步骤组件（4 天）

| 任务 | 文件 | 说明 |
|------|------|------|
| 4.1 StepBasicInfo | `src/renderer/src/components/agent/wizard/StepBasicInfo.tsx` | 名称/备注/皮肤 |
| 4.2 StepPersonaPreset | `src/renderer/src/components/agent/wizard/StepPersonaPreset.tsx` | 预设选择列表 |
| 4.3 StepPersonaAdvanced | `src/renderer/src/components/agent/wizard/StepPersonaAdvanced.tsx` | 高级自定义表单 |
| 4.4 StepPersona | `src/renderer/src/components/agent/wizard/StepPersona.tsx` | 预设/高级模式切换容器 |
| 4.5 StepTools | `src/renderer/src/components/agent/wizard/StepTools.tsx` | 工具配置 |
| 4.6 StepRobot | `src/renderer/src/components/agent/wizard/StepRobot.tsx` | 机器人绑定 |
| 4.7 StepLLM | `src/renderer/src/components/agent/wizard/StepLLM.tsx` | LLM 模型配置 |

### 阶段 5: 集成测试 + 边界处理（1 天）

| 任务 | 说明 |
|------|------|
| 5.1 全链路联调 | 创建向导 → 提交 → 实例列表刷新 → 实例视图跳转 |
| 5.2 预设 CRUD 测试 | 创建/读取/更新/删除自定义预设 |
| 5.3 边界情况测试 | 空数据、重复名称、步骤切换、取消等 |
| 5.4 数据持久化测试 | 重启应用验证数据不丢失 |

---

## 第3章 核心代码实现

### 3.1 AgentCreateWizard.tsx（向导容器）

```tsx
// src/renderer/src/components/agent/AgentCreateWizard.tsx
import React, { useCallback } from 'react'
import { Button } from '@heroui/react'
import { useWizardStore } from '../../stores/wizardStore'
import { useUIStore } from '../../stores/uiStore'
import StepIndicator from './wizard/StepIndicator'
import StepBasicInfo from './wizard/StepBasicInfo'
import StepPersona from './wizard/StepPersona'
import StepTools from './wizard/StepTools'
import StepRobot from './wizard/StepRobot'
import StepLLM from './wizard/StepLLM'

const STEPS = ['基本信息', '人设', '工具', '机器人', 'LLM'] as const

const AgentCreateWizard: React.FC = () => {
  const { currentStep, completedSteps, submitting, nextStep, prevStep, goToStep, submit } = useWizardStore()
  const { navigateToAgent } = useUIStore()

  const handleSubmit = useCallback(async () => {
    const agentId = await submit()
    if (agentId) {
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
  const canProceed = checkStepValid(currentStep) // 校验当前步骤数据是否完整

  return (
    <div className="flex flex-col h-full">
      {/* 步骤指示器 */}
      <StepIndicator
        steps={STEPS}
        currentStep={currentStep}
        completedSteps={completedSteps}
        onStepClick={goToStep}
      />

      {/* 表单内容 */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-3xl mx-auto">
          {renderStep()}
        </div>
      </div>

      {/* 底部按钮 */}
      <div className="shrink-0 px-6 py-4 border-t border-gray-100 bg-white flex items-center justify-between">
        <Button
          size="sm"
          variant="ghost"
          isDisabled={currentStep === 0}
          onPress={prevStep}
        >
          上一步
        </Button>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            onPress={() => {
              // 确认离开对话框
              if (confirm('当前配置未保存，确认离开？')) {
                navigateToAgent('') // 回到导航视图
              }
            }}
          >
            取消
          </Button>
          {isLastStep ? (
            <Button
              size="sm"
              variant="primary"
              isDisabled={submitting || !canProceed}
              isPending={submitting}
              onPress={handleSubmit}
            >
              {submitting ? '创建中...' : '确定'}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="primary"
              isDisabled={!canProceed}
              onPress={nextStep}
            >
              下一步
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

function checkStepValid(step: number): boolean {
  const { formData } = useWizardStore.getState()
  switch (step) {
    case 0: return formData.name.trim().length > 0
    case 1: return formData.persona.identity.trim().length > 0
    case 2: return Object.keys(formData.enabledTools).length > 0
    case 3: return true // 可选
    case 4: return !!formData.llmConfig.mainModel.modelId
    default: return false
  }
}

export default AgentCreateWizard
```

### 3.2 wizardStore.ts

```typescript
// src/renderer/src/stores/wizardStore.ts
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
  qqBinding: {
    enabled: false,
    accountId: '',
    groupIds: [],
  },
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
    // 只允许跳转到已完成的步骤或当前步骤
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
    if (currentStep > 0) {
      set({ currentStep: currentStep - 1 })
    }
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
```

### 3.3 StepIndicator.tsx

```tsx
// src/renderer/src/components/agent/wizard/StepIndicator.tsx
import React from 'react'

interface StepIndicatorProps {
  steps: readonly string[]
  currentStep: number
  completedSteps: number[]
  onStepClick: (step: number) => void
}

const StepIndicator: React.FC<StepIndicatorProps> = ({ steps, currentStep, completedSteps, onStepClick }) => {
  return (
    <div className="shrink-0 px-6 py-4 border-b border-gray-100 bg-white">
      <div className="flex items-center justify-center gap-0 max-w-xl mx-auto">
        {steps.map((label, index) => {
          const isCompleted = completedSteps.includes(index)
          const isActive = index === currentStep
          const isClickable = isCompleted || index < currentStep

          return (
            <React.Fragment key={index}>
              {/* 步骤圆点 */}
              <button
                onClick={() => isClickable && onStepClick(index)}
                disabled={!isClickable}
                className={`
                  flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-colors
                  ${isActive ? 'bg-blue-50 text-blue-600 border border-blue-200' : ''}
                  ${isCompleted ? 'text-green-600' : ''}
                  ${!isClickable ? 'text-gray-400 cursor-not-allowed' : 'cursor-pointer hover:text-gray-600'}
                `}
              >
                <span className={`
                  w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold
                  ${isActive ? 'bg-blue-500 text-white' : ''}
                  ${isCompleted ? 'bg-green-500 text-white' : ''}
                  ${!isActive && !isCompleted ? 'bg-gray-200 text-gray-500' : ''}
                `}>
                  {isCompleted ? '✓' : index + 1}
                </span>
                <span className="hidden sm:inline">{label}</span>
              </button>

              {/* 连接线 */}
              {index < steps.length - 1 && (
                <div className={`flex-1 h-px mx-1 ${completedSteps.includes(index) ? 'bg-green-300' : 'bg-gray-200'}`} />
              )}
            </React.Fragment>
          )
        })}
      </div>
    </div>
  )
}

export default StepIndicator
```

### 3.4 StepPersona.tsx（人设模式切换）

```tsx
// src/renderer/src/components/agent/wizard/StepPersona.tsx
import React, { useEffect, useState } from 'react'
import { Button, RadioGroup, Radio } from '@heroui/react'
import { useWizardStore } from '../../../stores/wizardStore'
import StepPersonaPreset from './StepPersonaPreset'
import StepPersonaAdvanced from './StepPersonaAdvanced'

const StepPersona: React.FC = () => {
  const { formData, updateFormData } = useWizardStore()
  const [mode, setMode] = useState<'preset' | 'advanced'>(formData.personaMode)

  const handleModeChange = (newMode: 'preset' | 'advanced') => {
    if (newMode === 'advanced' && mode === 'preset' && formData.personaPresetId) {
      // 从预设切换到高级模式：自动填充预设数据
      // preset 数据通过 IPC 获取，填充到 formData.persona
    } else if (newMode === 'preset' && mode === 'advanced') {
      // 从高级模式切换到预设模式：确认提示
      const confirmed = confirm('切换将丢失自定义内容，确认？')
      if (!confirmed) return
    }
    setMode(newMode)
    updateFormData({ personaMode: newMode })
  }

  return (
    <div className="space-y-6">
      {/* 模式切换 */}
      <RadioGroup
        value={mode}
        onChange={(val) => handleModeChange(val as 'preset' | 'advanced')}
        orientation="horizontal"
        className="mb-4"
      >
        <Radio value="preset">
          <Radio.Control />
          <Radio.Label>使用预设</Radio.Label>
        </Radio>
        <Radio value="advanced">
          <Radio.Control />
          <Radio.Label>高级自定义</Radio.Label>
        </Radio>
      </RadioGroup>

      {/* 模式内容 */}
      {mode === 'preset' ? <StepPersonaPreset /> : <StepPersonaAdvanced />}
    </div>
  )
}

export default StepPersona
```

### 3.5 StepTools.tsx（工具配置）

```tsx
// src/renderer/src/components/agent/wizard/StepTools.tsx
import React, { useEffect, useState } from 'react'
import { Checkbox, Tooltip, Collapsible } from '@heroui/react'
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
  const { formData, updateFormData } = useWizardStore()
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
      // 初始化默认全部启用
      const enabled: Record<string, boolean> = {}
      result.forEach(t => { enabled[t.name] = true })
      if (Object.keys(formData.enabledTools).length === 0) {
        updateFormData({ enabledTools: enabled })
      }
    } catch (err) {
      console.error('加载工具列表失败:', err)
    } finally {
      setLoading(false)
    }
  }

  // 按分类分组
  const grouped = tools.reduce<Record<string, ToolItem[]>>((acc, tool) => {
    if (!acc[tool.category]) acc[tool.category] = []
    acc[tool.category].push(tool)
    return acc
  }, {})

  const enabledCount = Object.values(formData.enabledTools).filter(Boolean).length
  const totalCount = tools.length

  const toggleTool = (toolName: string) => {
    updateFormData({
      enabledTools: {
        ...formData.enabledTools,
        [toolName]: !formData.enabledTools[toolName],
      },
    })
  }

  const toggleAll = () => {
    const allEnabled = enabledCount === totalCount
    const newEnabled: Record<string, boolean> = {}
    tools.forEach(t => { newEnabled[t.name] = !allEnabled })
    updateFormData({ enabledTools: newEnabled })
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
      {/* 顶部统计 */}
      <div className="flex items-center justify-between">
        <span className="text-sm text-gray-500">
          已启用: <strong className="text-gray-700">{enabledCount}</strong>/{totalCount}
        </span>
        <button
          onClick={toggleAll}
          className="text-xs text-blue-600 hover:text-blue-700"
        >
          {enabledCount === totalCount ? '取消全选' : '全选'}
        </button>
      </div>

      {/* 分类列表 */}
      {Object.entries(grouped).map(([category, categoryTools]) => (
        <div key={category} className="border border-gray-200 rounded-lg overflow-hidden">
          {/* 分类头部 */}
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

          {/* 工具列表 */}
          {!collapsedCategories.has(category) && (
            <div className="divide-y divide-gray-100">
              {categoryTools.map(tool => (
                <div key={tool.name} className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50/50">
                  <Checkbox
                    isSelected={!!formData.enabledTools[tool.name]}
                    onChange={() => toggleTool(tool.name)}
                  >
                    <Checkbox.Content>
                      <Checkbox.Control>
                        <Checkbox.Indicator />
                      </Checkbox.Control>
                    </Checkbox.Content>
                  </Checkbox>

                  {/* 工具名称 + 悬停详情 */}
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
                                {p.name}: {p.type} {p.required ? '(必填)' : '(可选)'} - {p.description}
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
                    showArrow
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
```

### 3.6 StepLLM.tsx（LLM 模型配置）

```tsx
// src/renderer/src/components/agent/wizard/StepLLM.tsx
import React, { useEffect } from 'react'
import { Select, ListBox, Checkbox } from '@heroui/react'
import { useWizardStore } from '../../../stores/wizardStore'
import { useModelStore } from '../../../stores/modelStore'

const StepLLM: React.FC = () => {
  const { formData, updateLLMConfig } = useWizardStore()
  const { models, fetchModels } = useModelStore()

  useEffect(() => {
    fetchModels()
  }, [fetchModels])

  // 按 Provider 分组
  const providerModels = models.reduce<Record<string, typeof models>>((acc, m) => {
    if (!acc[m.providerId]) acc[m.providerId] = []
    acc[m.providerId].push(m)
    return acc
  }, {})

  const providers = Object.keys(providerModels)

  // 渲染模型选择器
  const renderModelSelector = (
    label: string,
    description: string,
    selection: typeof formData.llmConfig.mainModel,
    onChange: (val: typeof selection) => void,
    showSameAsMain?: boolean,
  ) => (
    <div className="p-4 bg-white rounded-lg border border-gray-200">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h4 className="text-sm font-medium text-gray-700">{label}</h4>
          <p className="text-xs text-gray-400 mt-0.5">{description}</p>
        </div>
      </div>

      {showSameAsMain && (
        <Checkbox
          isSelected={selection.sameAsMain}
          onChange={(checked) => onChange({ ...selection, sameAsMain: checked })}
          className="mb-3"
        >
          <Checkbox.Content>
            <Checkbox.Control>
              <Checkbox.Indicator />
            </Checkbox.Control>
            <span className="text-sm text-gray-600">与主智能体相同</span>
          </Checkbox.Content>
        </Checkbox>
      )}

      {!selection.sameAsMain && (
        <div className="flex gap-3">
          <Select
            className="flex-1"
            placeholder="选择 Provider"
            selectedKey={selection.providerId}
            onSelectionChange={(key) => {
              const providerId = key as string
              const firstModel = providerModels[providerId]?.[0]
              onChange({
                ...selection,
                providerId,
                modelId: firstModel?.id ?? '',
                modelName: firstModel?.modelName ?? '',
              })
            }}
          >
            <Select.Trigger>
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                {providers.map(pid => (
                  <ListBox.Item key={pid} id={pid} textValue={pid}>
                    {pid}
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                ))}
              </ListBox>
            </Select.Popover>
          </Select>

          <Select
            className="flex-1"
            placeholder="选择模型"
            selectedKey={selection.modelId}
            onSelectionChange={(key) => {
              const modelId = key as string
              const model = models.find(m => m.id === modelId)
              onChange({
                ...selection,
                modelId,
                modelName: model?.modelName ?? '',
              })
            }}
            isDisabled={!selection.providerId}
          >
            <Select.Trigger>
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                {(providerModels[selection.providerId] ?? []).map(m => (
                  <ListBox.Item key={m.id} id={m.id} textValue={m.modelName}>
                    {m.modelName}
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                ))}
              </ListBox>
            </Select.Popover>
          </Select>
        </div>
      )}

      {/* 模型信息 */}
      {!selection.sameAsMain && selection.modelId && (
        <div className="mt-2 text-xs text-gray-400">
          {(() => {
            const model = models.find(m => m.id === selection.modelId)
            if (!model) return null
            return (
              <>
                <span>上下文窗口: {model.contextWindow.toLocaleString()}</span>
                <span className="mx-1">·</span>
                <span>FC: {model.supportsFunctionCalling ? '✅' : '❌'}</span>
              </>
            )
          })()}
        </div>
      )}
    </div>
  )

  if (models.length === 0) {
    return (
      <div className="text-sm text-gray-400 text-center py-8">
        请先在模型面板添加模型
        <br />
        <button
          onClick={() => {/* 跳转到模型面板 */}}
          className="text-blue-500 hover:text-blue-600 mt-2"
        >
          前往模型配置
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {renderModelSelector(
        '主智能体模型',
        '主智能体使用的主要 LLM 模型，负责核心决策和工具调用',
        formData.llmConfig.mainModel,
        (val) => updateLLMConfig({ mainModel: val }),
      )}
      {renderModelSelector(
        'QQ 机器人模型',
        'QQ 机器人使用的 LLM 模型，用于回复游戏外消息',
        formData.llmConfig.qqBotModel,
        (val) => updateLLMConfig({ qqBotModel: val }),
        true,
      )}
      {renderModelSelector(
        '压缩模型',
        '用于对话历史压缩、上下文精炼的模型，通常使用轻量模型',
        formData.llmConfig.compressionModel,
        (val) => updateLLMConfig({ compressionModel: val }),
        true,
      )}
    </div>
  )
}

export default StepLLM
```

### 3.7 AgentConfigManager（SQLite 持久化）

```typescript
// src/main/agent/agent-config-manager.ts
import { randomUUID } from 'crypto'
import { DatabaseManager } from '../database'
import type { AgentConfig, AgentSummary } from '../../renderer/src/lib/types'

export class AgentConfigManager {
  private cache: Map<string, AgentConfig> = new Map()

  constructor() {
    this.loadFromDb()
  }

  async create(config: AgentConfig): Promise<string> {
    const id = `agent-${randomUUID().slice(0, 8)}`
    const now = Date.now()
    const record: AgentConfig = {
      ...config,
      id,
      createdAt: now,
      updatedAt: now,
    }
    this.cache.set(id, record)
    await this.saveToDb(id, record)
    return id
  }

  async update(id: string, config: Partial<AgentConfig>): Promise<boolean> {
    const existing = this.cache.get(id)
    if (!existing) return false
    const updated = { ...existing, ...config, updatedAt: Date.now() }
    this.cache.set(id, updated)
    await this.saveToDb(id, updated)
    return true
  }

  async delete(id: string): Promise<boolean> {
    const existed = this.cache.delete(id)
    if (existed) {
      const db = DatabaseManager.getInstance()
      db.run('DELETE FROM agents WHERE id = ?', [id])
    }
    return existed
  }

  list(): AgentSummary[] {
    return Array.from(this.cache.values()).map(c => ({
      id: c.id!,
      name: c.alias || c.name,
      status: 'offline' as const,
      toolCount: Object.values(c.tools.enabledTools).filter(Boolean).length,
      lastActiveAt: c.updatedAt,
      skinData: c.skinData,
    }))
  }

  get(id: string): AgentConfig | undefined {
    return this.cache.get(id)
  }

  private async loadFromDb(): Promise<void> {
    try {
      const db = DatabaseManager.getInstance()
      const rows = db.all('SELECT * FROM agents') as Array<{
        id: string; name: string; alias: string | null; skin_data: string | null
        persona_json: string; tools_json: string; qq_binding_json: string
        llm_config_json: string; created_at: number; updated_at: number
      }>
      for (const row of rows) {
        this.cache.set(row.id, {
          id: row.id,
          name: row.name,
          alias: row.alias ?? undefined,
          skinData: row.skin_data ?? undefined,
          persona: JSON.parse(row.persona_json),
          tools: JSON.parse(row.tools_json),
          qqBinding: JSON.parse(row.qq_binding_json),
          llmConfig: JSON.parse(row.llm_config_json),
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        })
      }
    } catch (err) {
      console.error('从 SQLite 加载智能体配置失败:', err)
    }
  }

  private async saveToDb(id: string, config: AgentConfig): Promise<void> {
    const db = DatabaseManager.getInstance()
    db.run(
      `INSERT OR REPLACE INTO agents (id, name, alias, skin_data, persona_json, tools_json, qq_binding_json, llm_config_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        config.name,
        config.alias ?? null,
        config.skinData ?? null,
        JSON.stringify(config.persona),
        JSON.stringify(config.tools),
        JSON.stringify(config.qqBinding),
        JSON.stringify(config.llmConfig),
        config.createdAt ?? Date.now(),
        config.updatedAt ?? Date.now(),
      ],
    )
  }
}
```

### 3.8 PersonaPresetManager

```typescript
// src/main/agent/persona-preset-manager.ts
import { randomUUID } from 'crypto'
import { DatabaseManager } from '../database'
import { BUILTIN_IDENTITY_TEMPLATES, listIdentityTemplates } from '../prompt/agent/identity-templates'
import type { PersonaPreset } from '../../renderer/src/lib/types'

export class PersonaPresetManager {
  private builtinPresets: Map<string, PersonaPreset> = new Map()
  private customPresets: Map<string, PersonaPreset> = new Map()

  constructor() {
    this.loadBuiltinPresets()
    this.loadCustomPresets()
  }

  private loadBuiltinPresets(): void {
    const templates = listIdentityTemplates()
    for (const template of templates) {
      this.builtinPresets.set(template.id, {
        id: template.id,
        name: template.name,
        description: template.description,
        identity: template.identity,
        expertise: template.recommendedToolCategories,
        personality: template.personality,
        workflowId: template.recommendedWorkflow ?? 'explore_gather',
        behaviorRules: {
          core: template.rules.core,
          strategy: template.rules.strategy.map(s => ({ name: s.name, description: s.description, priority: s.priority })),
          constraints: template.rules.constraints.map(c => ({ name: c.name, description: c.description, consequence: c.consequence })),
        },
        recommendedToolCategories: template.recommendedToolCategories,
        isBuiltin: true,
      })
    }
  }

  private loadCustomPresets(): void {
    try {
      const db = DatabaseManager.getInstance()
      const rows = db.all('SELECT * FROM persona_presets WHERE is_builtin = 0') as Array<{
        id: string; name: string; description: string | null; identity: string
        expertise_json: string; personality_json: string; workflow_id: string
        behavior_rules_json: string | null; recommended_tool_categories_json: string | null
        created_at: number
      }>
      for (const row of rows) {
        this.customPresets.set(row.id, {
          id: row.id,
          name: row.name,
          description: row.description ?? '',
          identity: row.identity,
          expertise: JSON.parse(row.expertise_json),
          personality: JSON.parse(row.personality_json),
          workflowId: row.workflow_id,
          behaviorRules: row.behavior_rules_json ? JSON.parse(row.behavior_rules_json) : { core: [], strategy: [], constraints: [] },
          recommendedToolCategories: row.recommended_tool_categories_json ? JSON.parse(row.recommended_tool_categories_json) : [],
          isBuiltin: false,
          createdAt: row.created_at,
        })
      }
    } catch (err) {
      console.error('加载自定义预设失败:', err)
    }
  }

  list(): PersonaPreset[] {
    return [...this.builtinPresets.values(), ...this.customPresets.values()]
  }

  get(id: string): PersonaPreset | undefined {
    return this.builtinPresets.get(id) ?? this.customPresets.get(id)
  }

  async create(preset: Omit<PersonaPreset, 'id' | 'isBuiltin' | 'createdAt'>): Promise<string> {
    const id = `custom-${randomUUID().slice(0, 8)}`
    const now = Date.now()
    const record: PersonaPreset = {
      ...preset,
      id,
      isBuiltin: false,
      createdAt: now,
    }
    this.customPresets.set(id, record)
    await this.saveToDb(record)
    return id
  }

  async update(id: string, preset: Partial<PersonaPreset>): Promise<boolean> {
    const existing = this.customPresets.get(id)
    if (!existing) return false
    const updated = { ...existing, ...preset }
    this.customPresets.set(id, updated)
    await this.saveToDb(updated)
    return true
  }

  async delete(id: string): Promise<boolean> {
    if (this.builtinPresets.has(id)) return false // 内置预设不可删除
    const existed = this.customPresets.delete(id)
    if (existed) {
      const db = DatabaseManager.getInstance()
      db.run('DELETE FROM persona_presets WHERE id = ?', [id])
    }
    return existed
  }

  private async saveToDb(preset: PersonaPreset): Promise<void> {
    if (preset.isBuiltin) return // 内置预设不写入 SQLite
    const db = DatabaseManager.getInstance()
    db.run(
      `INSERT OR REPLACE INTO persona_presets (id, name, description, identity, expertise_json, personality_json, workflow_id, behavior_rules_json, recommended_tool_categories_json, is_builtin, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      [
        preset.id,
        preset.name,
        preset.description,
        preset.identity,
        JSON.stringify(preset.expertise),
        JSON.stringify(preset.personality),
        preset.workflowId,
        JSON.stringify(preset.behaviorRules),
        JSON.stringify(preset.recommendedToolCategories),
        preset.createdAt ?? Date.now(),
      ],
    )
  }
}
```

### 3.9 tool-handler.ts

```typescript
// src/main/ipc/tool-handler.ts
import { ipcMain } from 'electron'
import { WorkspaceManager } from '../workspace'
import type { ToolInfo } from '../../renderer/src/lib/types'

// 工具中文名映射
const TOOL_LOCALE_MAP: Record<string, { displayName: string; categoryLabel: string }> = {
  // 感知类
  scan_surroundings: { displayName: '视野扫描', categoryLabel: '感知' },
  block_identifier: { displayName: '方块识别', categoryLabel: '感知' },
  entity_detection: { displayName: '实体检测', categoryLabel: '感知' },
  light_detection: { displayName: '光照检测', categoryLabel: '感知' },
  sound_detection: { displayName: '声音检测', categoryLabel: '感知' },
  environment_analysis: { displayName: '环境分析', categoryLabel: '感知' },
  // 移动类
  path_planning: { displayName: '路径规划', categoryLabel: '移动' },
  auto_navigate: { displayName: '自动寻路', categoryLabel: '移动' },
  jump: { displayName: '跳跃', categoryLabel: '移动' },
  fly: { displayName: '飞行', categoryLabel: '移动' },
  // 生存类
  auto_mine: { displayName: '自动采集', categoryLabel: '生存' },
  farm: { displayName: '耕种', categoryLabel: '生存' },
  fish: { displayName: '钓鱼', categoryLabel: '生存' },
  craft: { displayName: '合成', categoryLabel: '生存' },
  smelt: { displayName: '熔炼', categoryLabel: '生存' },
  // 对话类
  chat: { displayName: '聊天', categoryLabel: '对话' },
  command_response: { displayName: '指令响应', categoryLabel: '对话' },
  sentiment_analysis: { displayName: '情感分析', categoryLabel: '对话' },
  // 背包类
  inventory_manage: { displayName: '物品管理', categoryLabel: '背包' },
  equipment_manage: { displayName: '装备管理', categoryLabel: '背包' },
  container_operation: { displayName: '容器操作', categoryLabel: '背包' },
  item_sort: { displayName: '物品分类', categoryLabel: '背包' },
  // QQ 类
  qq_send: { displayName: '消息发送', categoryLabel: 'QQ' },
  qq_group_manage: { displayName: '群管理', categoryLabel: 'QQ' },
  qq_file_transfer: { displayName: '文件传输', categoryLabel: 'QQ' },
  qq_notify: { displayName: '通知', categoryLabel: 'QQ' },
  // 方块类
  mine_block: { displayName: '挖掘方块', categoryLabel: '方块' },
  place_block: { displayName: '放置方块', categoryLabel: '方块' },
  use_block: { displayName: '使用方块', categoryLabel: '方块' },
  area_operation: { displayName: '区域操作', categoryLabel: '方块' },
  // 实体类
  interact_entity: { displayName: '交互实体', categoryLabel: '实体' },
  lead_entity: { displayName: '牵引实体', categoryLabel: '实体' },
  // 战斗类
  set_combat_mode: { displayName: '设置战斗模式', categoryLabel: '战斗' },
  stop_combat: { displayName: '停止战斗', categoryLabel: '战斗' },
}

// 分类映射
const CATEGORY_LABEL_MAP: Record<string, string> = {
  perception: '感知类',
  movement: '移动类',
  survival: '生存类',
  dialogue: '对话类',
  inventory: '背包类',
  qq: 'QQ 类',
  block: '方块类',
  entity: '实体类',
  combat: '战斗类',
  chat: '对话类',
  memory: '记忆类',
  task: '任务类',
}

export function registerToolHandlers(): void {
  ipcMain.handle('tool:list-all', async () => {
    const allTools = WorkspaceManager.getToolRegistry().getAll()
    const seen = new Set<string>()
    const toolList: ToolInfo[] = []

    for (const tools of allTools.values()) {
      for (const tool of tools) {
        if (seen.has(tool.name)) continue
        seen.add(tool.name)

        const locale = TOOL_LOCALE_MAP[tool.name] ?? {
          displayName: tool.name,
          categoryLabel: tool.category ?? '其他',
        }

        const category = tool.category ?? 'other'
        const categoryLabel = CATEGORY_LABEL_MAP[category] ?? locale.categoryLabel

        toolList.push({
          name: tool.name,
          displayName: locale.displayName,
          description: tool.description ?? '',
          category,
          categoryLabel,
          parameters: (tool.parameters ?? []).map(p => ({
            name: p.name,
            type: p.type ?? 'string',
            description: p.description ?? '',
            required: p.required ?? false,
            defaultValue: p.default,
          })),
          example: tool.example,
        })
      }
    }

    return toolList
  })
}
```

---

## 第4章 前后端 IPC 通信

### 4.1 新增 IPC Channel

| Channel | 方向 | 注册位置 | 实现 |
|---------|:----:|----------|------|
| `preset:list` | R→M | `preset-handler.ts` | PersonaPresetManager.list() |
| `preset:get` | R→M | `preset-handler.ts` | PersonaPresetManager.get(id) |
| `preset:create` | R→M | `preset-handler.ts` | PersonaPresetManager.create(preset) |
| `preset:update` | R→M | `preset-handler.ts` | PersonaPresetManager.update(id, preset) |
| `preset:delete` | R→M | `preset-handler.ts` | PersonaPresetManager.delete(id) |
| `tool:list-all` | R→M | `tool-handler.ts` | ToolRegistry → 合并中文映射 |

### 4.2 IPC 入口更新

```typescript
// src/main/ipc/index.ts (更新版)
import { registerChatHandlers } from './chat-handler'
import { registerConfigHandlers } from './config-handler'
import { registerWindowHandlers } from './window-handler'
import { registerDashboardHandlers } from './dashboard-handler'
import { registerAgentHandlers } from './agent-handler'
import { registerModelHandlers } from './model-handler'
import { registerPresetHandlers } from './preset-handler'   // 新增
import { registerToolHandlers } from './tool-handler'       // 新增

export function registerAllIpcHandlers(mainWindow: BrowserWindow): void {
  registerChatHandlers()
  registerConfigHandlers()
  registerWindowHandlers(mainWindow)
  registerDashboardHandlers()
  registerAgentHandlers()
  registerModelHandlers()
  registerPresetHandlers()   // 新增
  registerToolHandlers()     // 新增
}
```

### 4.3 前端 IPC 封装

```typescript
// src/renderer/src/lib/ipc.ts (新增 API)
import type { PersonaPreset, ToolInfo } from './types'

export const presetApi = {
  list: () => window.electronAPI.invoke('preset:list') as Promise<PersonaPreset[]>,
  get: (id: string) => window.electronAPI.invoke('preset:get', { id }) as Promise<PersonaPreset | null>,
  create: (preset: Omit<PersonaPreset, 'id' | 'isBuiltin' | 'createdAt'>) =>
    window.electronAPI.invoke('preset:create', preset) as Promise<{ id: string; success: boolean }>,
  update: (id: string, preset: Partial<PersonaPreset>) =>
    window.electronAPI.invoke('preset:update', { id, preset }) as Promise<{ success: boolean }>,
  delete: (id: string) =>
    window.electronAPI.invoke('preset:delete', { id }) as Promise<{ success: boolean }>,
}

export const toolApi = {
  listAll: () => window.electronAPI.invoke('tool:list-all') as Promise<ToolInfo[]>,
}
```

---

## 第5章 数据库变更

### 5.1 SQLite 建表 SQL

```sql
-- 智能体配置表
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  alias TEXT,
  skin_data TEXT,
  persona_json TEXT NOT NULL,
  tools_json TEXT NOT NULL,
  qq_binding_json TEXT NOT NULL,
  llm_config_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 人设预设表
CREATE TABLE IF NOT EXISTS persona_presets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  identity TEXT NOT NULL,
  expertise_json TEXT NOT NULL,
  personality_json TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  behavior_rules_json TEXT,
  recommended_tool_categories_json TEXT,
  is_builtin INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);
```

### 5.2 DatabaseManager 修改

在 `src/main/database/database-manager.ts` 的初始化逻辑中，确保上述建表 SQL 在应用启动时执行。

---

## 第6章 文件变更清单

### 6.1 新增文件

| 文件路径 | 行数估计 | 说明 |
|----------|:--------:|------|
| `src/renderer/src/components/agent/AgentCreateWizard.tsx` | ~110 | 向导容器 |
| `src/renderer/src/components/agent/wizard/StepIndicator.tsx` | ~60 | 步骤指示器 |
| `src/renderer/src/components/agent/wizard/StepBasicInfo.tsx` | ~80 | 基本信息 |
| `src/renderer/src/components/agent/wizard/StepPersona.tsx` | ~60 | 人设模式切换 |
| `src/renderer/src/components/agent/wizard/StepPersonaPreset.tsx` | ~120 | 预设选择 |
| `src/renderer/src/components/agent/wizard/StepPersonaAdvanced.tsx` | ~200 | 高级自定义 |
| `src/renderer/src/components/agent/wizard/StepTools.tsx` | ~150 | 工具配置 |
| `src/renderer/src/components/agent/wizard/StepRobot.tsx` | ~120 | 机器人绑定 |
| `src/renderer/src/components/agent/wizard/StepLLM.tsx` | ~160 | LLM 配置 |
| `src/renderer/src/stores/wizardStore.ts` | ~120 | 向导状态 |
| `src/main/agent/agent-config-manager.ts` | ~120 | AgentConfigManager |
| `src/main/agent/persona-preset-manager.ts` | ~140 | 预设管理器 |
| `src/main/ipc/preset-handler.ts` | ~40 | 预设 IPC |
| `src/main/ipc/tool-handler.ts` | ~100 | 工具 IPC |

### 6.2 修改文件

| 文件路径 | 修改内容 |
|----------|----------|
| `src/renderer/src/lib/types.ts` | 新增 PersonaPreset, AgentPersona, AgentLLMConfig, ModelSelection, ToolInfo, WizardFormData；修改 AgentConfig 和 AgentToolConfig |
| `src/renderer/src/lib/ipc.ts` | 新增 presetApi 和 toolApi |
| `src/renderer/src/stores/agentStore.ts` | 支持新 AgentConfig 数据结构 |
| `src/renderer/src/components/agent/AgentCreatePage.tsx` | 包装 AgentCreateWizard |
| `src/renderer/src/components/agent/sections/BasicInfoSection.tsx` | 新增备注字段 |
| `src/renderer/src/components/agent/sections/QQBindSection.tsx` | 新增机器人设置项 |
| `src/main/ipc/agent-handler.ts` | 替换 AgentConfigManager 为 SQLite 版本 |
| `src/main/ipc/index.ts` | 注册新 Handler |
| `src/main/database/database-manager.ts` | 初始化新表 |

### 6.3 删除文件

| 文件路径 | 说明 |
|----------|------|
| `src/renderer/src/components/agent/AgentConfigForm.tsx` | 替换为 AgentCreateWizard |
| `src/renderer/src/components/agent/sections/IdentitySection.tsx` | 替换为 StepPersona |
| `src/renderer/src/components/agent/sections/ToolConfigSection.tsx` | 替换为 StepTools |
| `src/renderer/src/components/agent/sections/MemoryConfigSection.tsx` | 不再需要 |
| `src/renderer/src/components/agent/sections/ExecutionRulesSection.tsx` | 移入人设高级模式 |
| `src/renderer/src/components/agent/sections/ScheduleSection.tsx` | 不再需要 |

---

## 第7章 测试计划

### 7.1 单元测试

| 测试项 | 文件 | 覆盖内容 |
|--------|------|----------|
| AgentConfigManager CRUD | `__tests__/agent/agent-config-manager.test.ts` | 创建/读取/更新/删除/列表 |
| PersonaPresetManager | `__tests__/agent/persona-preset-manager.test.ts` | 内置预设加载、自定义预设 CRUD |
| wizardStore | `__tests__/renderer/wizard-store.test.ts` | 步骤切换、数据更新、提交 |
| IPC Handler | `__tests__/ipc/preset-handler.test.ts` | preset CRUD IPC |
| IPC Handler | `__tests__/ipc/tool-handler.test.ts` | 工具列表获取 |

### 7.2 集成测试

| 测试项 | 说明 |
|--------|------|
| 创建向导全流程 | 填写所有步骤 → 确定 → 实例列表刷新 |
| 预设模式切换 | 预设 → 高级 → 预设，数据一致性 |
| 空数据处理 | 无工具/无模型/无QQ账号时的显示 |
| 数据持久化 | 重启后验证实例和预设存在 |
| 步骤验证 | 各步骤必填字段校验 |

### 7.3 手动测试清单

| # | 测试场景 | 预期结果 |
|---|----------|----------|
| 1 | 点击 [+ 新建]，进入创建向导 | 5 步骤指示器显示，当前为步骤1 |
| 2 | 不填名称，点击"下一步" | 按钮禁用 |
| 3 | 填写名称，点击"下一步" | 进入步骤2 |
| 4 | 选择一个预设，点击"下一步" | 进入步骤3 |
| 5 | 点击"上一步"返回步骤2 | 预设选择保留 |
| 6 | 在步骤3点击某个工具开关 | 工具状态切换，顶部计数更新 |
| 7 | 悬停工具名称 | 显示 tooltip 详情 |
| 8 | 在步骤4勾选"绑定QQ"，选择账号和群 | 子选项正确显示 |
| 9 | 在步骤5配置 LLM 模型 | 三个模型选择区域正常 |
| 10 | 点击"确定" | 创建成功，跳转到实例视图 |
| 11 | 验证左栏实例列表 | 新智能体出现在列表中 |
| 12 | 重启应用，验证实例列表 | 数据不丢失 |

---

## 第8章 风险与应对

| 风险 | 影响 | 应对措施 |
|------|------|----------|
| 工具列表为空 | 步骤3无法配置 | 显示引导提示，用户可先连接 Adapter Core |
| 模型列表为空 | 步骤5无法配置 | 显示引导提示，提供跳转到模型面板的链接 |
| 预设数据量大 | 步骤2加载慢 | 分页加载预设列表，默认只显示前 10 个 |
| 旧版 AgentConfig 兼容 | 升级后数据丢失 | 提供数据迁移脚本，将旧内存数据写入 SQLite |
| 步骤间切换频繁 | 表单数据丢失 | wizardStore 保持所有步骤数据，切换不重置 |