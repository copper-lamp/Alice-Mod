import React, { useEffect, useState } from 'react'
import { Button, Select, ListBox, TextArea, Checkbox } from '@heroui/react'
import { useAgentStore } from '../../stores/agentStore'
import { useModelStore } from '../../stores/modelStore'
import { useUIStore } from '../../stores/uiStore'
import type { AgentConfig, AgentPersona, AgentToolConfig, QQBinding, ModelSelection } from '../../lib/types'
import BasicInfoSection from './sections/BasicInfoSection'
import QQBindSection from './sections/QQBindSection'

interface AgentConfigFormProps {
  agentId?: string
}

const defaultPersona: AgentPersona = {
  identity: '',
  expertise: [],
  personality: [],
  workflowId: '',
}

const defaultLLMConfig = {
  mainModel: { providerId: '', modelId: '', modelName: '' },
  qqBotModel: { providerId: '', modelId: '', modelName: '', sameAsMain: true },
  compressionModel: { providerId: '', modelId: '', modelName: '', sameAsMain: true },
}

const defaultConfig: AgentConfig = {
  name: '',
  persona: { ...defaultPersona },
  tools: { enabledTools: {} },
  qqBinding: { enabled: false, accountId: '', groupIds: [] },
  llmConfig: { ...defaultLLMConfig },
}

const AgentConfigForm: React.FC<AgentConfigFormProps> = ({ agentId }) => {
  const { createAgent, updateAgent, fetchAgent, currentAgent } = useAgentStore()
  const { models, fetchModels } = useModelStore()
  const { setLayoutMode, navigateToAgent, setActiveNav } = useUIStore()

  const [form, setForm] = useState<AgentConfig>(defaultConfig)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>('')

  useEffect(() => {
    fetchModels()
  }, [fetchModels])

  useEffect(() => {
    if (agentId) {
      fetchAgent(agentId)
    }
  }, [agentId])

  useEffect(() => {
    if (agentId && currentAgent && currentAgent.id === agentId) {
      setForm({
        name: currentAgent.name,
        alias: currentAgent.alias,
        skinData: currentAgent.skinData,
        persona: { ...currentAgent.persona },
        tools: { enabledTools: { ...currentAgent.tools.enabledTools } },
        qqBinding: {
          ...currentAgent.qqBinding,
          groupIds: [...(currentAgent.qqBinding.groupIds ?? [])],
        },
        llmConfig: JSON.parse(JSON.stringify(currentAgent.llmConfig)),
      })
    }
  }, [agentId, currentAgent])

  const handleSave = async () => {
    setSaving(true)
    setError('')
    try {
      const config: AgentConfig = {
        ...form,
        persona: form.persona,
        tools: form.tools,
        llmConfig: form.llmConfig,
      }
      if (agentId) {
        await updateAgent(agentId, config)
        setLayoutMode('agent-view')
      } else {
        const id = await createAgent(config)
        if (id) {
          navigateToAgent(id)
        } else {
          setError('智能体创建失败，请检查输入或稍后重试')
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建过程中发生错误')
    } finally {
      setSaving(false)
    }
  }

  const handleCancel = () => {
    setLayoutMode(agentId ? 'agent-view' : 'nav-view')
  }

  const updateField = <K extends keyof AgentConfig>(key: K, value: AgentConfig[K]) => {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* 顶部操作栏 */}
      <div className="shrink-0 px-6 py-4 border-b border-gray-100 bg-white flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-800">
          {agentId ? '编辑智能体' : '创建智能体'}
        </h2>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onPress={handleCancel}>
            取消
          </Button>
          <Button
            size="sm"
            variant="primary"
            isDisabled={saving || !form.name.trim() || !form.llmConfig.mainModel.modelId}
            isPending={saving}
            onPress={handleSave}
          >
            {saving ? '保存中...' : '保存'}
          </Button>
        </div>
      </div>

      {/* 表单内容 */}
      <div className="flex-1 min-h-0 overflow-y-auto px-6 py-6 pb-12 bg-white">
        {error && (
          <div className="mb-6 p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-600">
            {error}
          </div>
        )}

        <div className="max-w-2xl mx-auto space-y-8">
          {/* 基本信息 */}
          <section>
            <h3 className="text-sm font-semibold text-gray-800 mb-3">基本信息</h3>
            <BasicInfoSection
              name={form.name}
              skinData={form.skinData}
              onChange={(name, skinData) => setForm(prev => ({ ...prev, name, skinData }))}
            />
          </section>

          <hr className="border-gray-100" />

          {/* 模型选择 */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-800">模型选择</h3>
              <Button
                size="sm"
                variant="ghost"
                onPress={() => {
                  setLayoutMode('nav-view')
                  setActiveNav('model')
                }}
              >
                添加模型
              </Button>
            </div>
            <Select
              className="w-full"
              placeholder="请选择智能体使用的模型"
              selectedKey={form.llmConfig.mainModel.modelId || undefined}
              onSelectionChange={(key) => {
                if (key) {
                  const model = models.find(m => m.id === key)
                  if (model) {
                    updateField('llmConfig', {
                      ...form.llmConfig,
                      mainModel: {
                        providerId: model.providerId,
                        modelId: model.id,
                        modelName: model.modelName,
                      },
                    })
                  }
                }
              }}
            >
              <Select.Trigger className="w-full">
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  {models.map((model) => (
                    <ListBox.Item key={model.id} id={model.id} textValue={`${model.providerName} - ${model.modelName}`}>
                      {model.providerName} - {model.modelName}
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Select.Popover>
            </Select>
          </section>

          <hr className="border-gray-100" />

          {/* 人设配置 */}
          <section>
            <h3 className="text-sm font-semibold text-gray-800 mb-3">人设配置</h3>
            <div className="space-y-4">
              <div>
                <label className="text-xs text-gray-500 font-medium mb-1.5 block">身份描述</label>
                <TextArea
                  value={form.persona.identity}
                  onChange={(e) => updateField('persona', { ...form.persona, identity: e.target.value })}
                  placeholder="描述智能体的身份和角色定位..."
                  rows={3}
                  className="w-full resize-none"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 font-medium mb-1.5 block">个性特征（每行一个）</label>
                <TextArea
                  value={form.persona.personality.join('\n')}
                  onChange={(e) => updateField('persona', { ...form.persona, personality: e.target.value.split('\n').filter(Boolean) })}
                  placeholder="谨慎但不胆小&#10;有条理，会规划任务顺序&#10;乐于助人"
                  rows={3}
                  className="w-full resize-none"
                />
              </div>
            </div>
          </section>

          <hr className="border-gray-100" />

          {/* 工具配置 */}
          <section>
            <h3 className="text-sm font-semibold text-gray-800 mb-3">工具配置</h3>
            <p className="text-xs text-gray-400 mb-3">工具选择在创建向导中完成，此处仅显示当前配置的工具数量</p>
            <div className="text-sm text-gray-600">
              已启用 {Object.keys(form.tools.enabledTools).length} 个工具
            </div>
          </section>

          <hr className="border-gray-100" />

          {/* QQ 绑定 */}
          <section>
            <h3 className="text-sm font-semibold text-gray-800 mb-3">QQ 绑定</h3>
            <QQBindSection
              binding={form.qqBinding}
              onChange={(binding: QQBinding) => updateField('qqBinding', binding)}
            />
          </section>
        </div>
      </div>
    </div>
  )
}

export default AgentConfigForm