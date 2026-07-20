import React, { useEffect, useState } from 'react'
import { Select, ListBox, Checkbox } from '@heroui/react'
import { Check, X } from 'lucide-react'
import { useWizardStore } from '../../../stores/wizardStore'

interface ModelItem {
  id: string
  providerId: string
  modelName: string
  contextWindow?: number
  supportsFunctionCalling?: boolean
}

const StepLLM: React.FC = () => {
  const { formData, updateLLMConfig } = useWizardStore()
  const [models, setModels] = useState<ModelItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadModels()
  }, [])

  const loadModels = async () => {
    try {
      const result = await window.electronAPI.invoke('model:list') as ModelItem[]
      setModels(result || [])
    } catch {
      setModels([])
    } finally {
      setLoading(false)
    }
  }

  const providerModels = models.reduce<Record<string, ModelItem[]>>((acc, m) => {
    if (!acc[m.providerId]) acc[m.providerId] = []
    acc[m.providerId].push(m)
    return acc
  }, {})

  const providers = Object.keys(providerModels)

  const renderModelSelector = (
    label: string,
    description: string,
    selection: typeof formData.llmConfig.mainModel,
    onChange: (val: typeof selection) => void,
    showSameAsMain?: boolean,
  ) => (
    <div className="p-4 bg-white rounded-lg border border-gray-200">
      <h4 className="text-sm font-medium text-gray-700 mb-1">{label}</h4>
      <p className="text-xs text-gray-400 mb-3">{description}</p>

      {showSameAsMain && (
        <Checkbox
          isSelected={selection.sameAsMain}
          onChange={(checked) => {
            if (checked) {
              // 与主模型相同：清空具体配置，让后端回退到 mainModel
              onChange({ providerId: '', modelId: '', modelName: '', sameAsMain: true })
            } else {
              onChange({ ...selection, sameAsMain: false })
            }
          }}
          className="mb-3"
        >
          与主智能体相同
        </Checkbox>
      )}

      {(!showSameAsMain || !selection.sameAsMain) && (
        <div className="flex gap-3">
          <Select
            className="flex-1"
            placeholder="选择 Provider"
            selectedKey={selection.providerId}
            onSelectionChange={(key) => {
              const providerId = key as string
              const firstModel = providerModels[providerId]?.[0]
              onChange({ ...selection, providerId, modelId: firstModel?.id ?? '', modelName: firstModel?.modelName ?? '' })
            }}
          >
            <Select.Trigger>
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                {providers.map(pid => (
                  <ListBox.Item key={pid} id={pid} textValue={pid}>{pid}</ListBox.Item>
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
              onChange({ ...selection, modelId, modelName: model?.modelName ?? '' })
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
                  <ListBox.Item key={m.id} id={m.id} textValue={m.modelName}>{m.modelName}</ListBox.Item>
                ))}
              </ListBox>
            </Select.Popover>
          </Select>
        </div>
      )}

      {!selection.sameAsMain && selection.modelId && (() => {
        const model = models.find(m => m.id === selection.modelId)
        if (!model) return null
        return (
          <div className="mt-2 text-xs text-gray-400">
            <span>上下文窗口: {model.contextWindow?.toLocaleString() ?? '未知'}</span>
            <span className="mx-1">·</span>
            <span>FC: {model.supportsFunctionCalling ? <Check size={12} className="inline text-green-500" /> : <X size={12} className="inline text-red-400" />}</span>
          </div>
        )
      })()}
    </div>
  )

  if (loading) {
    return <div className="text-sm text-gray-400 text-center py-8">加载模型列表...</div>
  }

  if (models.length === 0) {
    return (
      <div className="text-sm text-gray-400 text-center py-8">
        请先在模型面板添加模型
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-medium text-gray-800 mb-1">模型选择</h3>
        <p className="text-xs text-gray-400 mb-2">配置智能体使用的 LLM 模型</p>
      </div>

      {renderModelSelector(
        '主智能体模型', '主智能体使用的主要 LLM 模型，负责核心决策和工具调用',
        formData.llmConfig.mainModel,
        (val) => updateLLMConfig({ mainModel: val }),
      )}
      {renderModelSelector(
        'QQ 机器人模型', 'QQ 机器人使用的 LLM 模型，用于回复游戏外消息',
        formData.llmConfig.qqBotModel,
        (val) => updateLLMConfig({ qqBotModel: val }),
        true,
      )}
      {renderModelSelector(
        '压缩模型', '用于对话历史压缩、上下文精炼的模型，通常使用轻量模型',
        formData.llmConfig.compressionModel,
        (val) => updateLLMConfig({ compressionModel: val }),
        true,
      )}
    </div>
  )
}

export default StepLLM
