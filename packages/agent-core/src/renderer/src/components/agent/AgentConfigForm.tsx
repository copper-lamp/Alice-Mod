import React, { useEffect, useState } from 'react'
import { Button, Select, ListBox, TextArea, Switch, Checkbox } from '@heroui/react'
import { useAgentStore } from '../../stores/agentStore'
import { useModelStore } from '../../stores/modelStore'
import { useUIStore } from '../../stores/uiStore'
import { memoryApi } from '../../lib/ipc'
import type { AgentConfig, AgentPersona, AgentToolConfig, QQBinding, ModelSelection, AgentSkillConfig, AgentSchedule } from '../../lib/types'
import BasicInfoSection from './sections/BasicInfoSection'
import ScheduleSection from './sections/ScheduleSection'

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
  const [availableSkills, setAvailableSkills] = useState<Array<{ id: string; name: string; description: string }>>([])

  useEffect(() => {
    fetchModels()
  }, [fetchModels])

  useEffect(() => {
    // 加载可用技能列表
    memoryApi.list({ type: 'skill', limit: 100 }).then(result => {
      const skills = (result.memories ?? []).map((m: any) => {
        const c = (m.content as Record<string, unknown>) ?? {}
        return {
          id: m.id ?? '',
          name: (c.name as string) ?? '',
          description: (c.description as string) ?? '',
        }
      })
      setAvailableSkills(skills)
    }).catch(() => {
      // 技能列表加载失败不影响主体功能
    })
  }, [])

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
            <div className="space-y-4">
              {/* 主智能体模型 */}
              <div className="p-4 bg-white rounded-lg border border-gray-200">
                <h4 className="text-sm font-medium text-gray-700 mb-1">主智能体模型</h4>
                <p className="text-xs text-gray-400 mb-3">主智能体使用的主要 LLM 模型，负责核心决策和工具调用</p>
                <Select
                  className="w-full"
                  placeholder="请选择模型"
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
              </div>

              {/* QQ 机器人模型 */}
              <div className="p-4 bg-white rounded-lg border border-gray-200">
                <h4 className="text-sm font-medium text-gray-700 mb-1">QQ 机器人模型</h4>
                <p className="text-xs text-gray-400 mb-3">QQ 机器人使用的 LLM 模型，用于回复游戏外消息</p>
                <Checkbox
                  isSelected={form.llmConfig.qqBotModel.sameAsMain ?? true}
                  onChange={(checked) => {
                    if (checked) {
                      // 与主模型相同：清空具体配置，让后端回退到 mainModel
                      updateField('llmConfig', {
                        ...form.llmConfig,
                        qqBotModel: { providerId: '', modelId: '', modelName: '', sameAsMain: true },
                      })
                    } else {
                      updateField('llmConfig', {
                        ...form.llmConfig,
                        qqBotModel: { ...form.llmConfig.qqBotModel, sameAsMain: false },
                      })
                    }
                  }}
                  className="mb-3"
                >
                  与主智能体相同
                </Checkbox>
                {(!form.llmConfig.qqBotModel.sameAsMain) && (
                  <Select
                    className="w-full"
                    placeholder="请选择模型"
                    selectedKey={form.llmConfig.qqBotModel.modelId || undefined}
                    onSelectionChange={(key) => {
                      if (key) {
                        const model = models.find(m => m.id === key)
                        if (model) {
                          updateField('llmConfig', {
                            ...form.llmConfig,
                            qqBotModel: {
                              providerId: model.providerId,
                              modelId: model.id,
                              modelName: model.modelName,
                              sameAsMain: false,
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
                )}
              </div>

              {/* 压缩模型 */}
              <div className="p-4 bg-white rounded-lg border border-gray-200">
                <h4 className="text-sm font-medium text-gray-700 mb-1">压缩模型</h4>
                <p className="text-xs text-gray-400 mb-3">用于对话历史压缩、上下文精炼的模型，通常使用轻量模型</p>
                <Checkbox
                  isSelected={form.llmConfig.compressionModel.sameAsMain ?? true}
                  onChange={(checked) => {
                    if (checked) {
                      updateField('llmConfig', {
                        ...form.llmConfig,
                        compressionModel: { providerId: '', modelId: '', modelName: '', sameAsMain: true },
                      })
                    } else {
                      updateField('llmConfig', {
                        ...form.llmConfig,
                        compressionModel: { ...form.llmConfig.compressionModel, sameAsMain: false },
                      })
                    }
                  }}
                  className="mb-3"
                >
                  与主智能体相同
                </Checkbox>
                {(!form.llmConfig.compressionModel.sameAsMain) && (
                  <Select
                    className="w-full"
                    placeholder="请选择模型"
                    selectedKey={form.llmConfig.compressionModel.modelId || undefined}
                    onSelectionChange={(key) => {
                      if (key) {
                        const model = models.find(m => m.id === key)
                        if (model) {
                          updateField('llmConfig', {
                            ...form.llmConfig,
                            compressionModel: {
                              providerId: model.providerId,
                              modelId: model.id,
                              modelName: model.modelName,
                              sameAsMain: false,
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
                )}
              </div>
            </div>
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

          {/* V27: 技能配置 */}
          <section>
            <h3 className="text-sm font-semibold text-gray-800 mb-3">技能配置</h3>
            <p className="text-xs text-gray-400 mb-3">
              选择此智能体可用的技能。未选中的技能将不会注入到系统提示词中。
              如不配置，则使用全局技能开关设置。
            </p>
            {availableSkills.length === 0 ? (
              <div className="text-sm text-gray-400 text-center py-4 bg-gray-50 rounded-lg">
                暂无可用技能，请先在"知识 → 技能管理"中创建技能
              </div>
            ) : (
              <div className="overflow-x-auto border border-gray-200 rounded-lg">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 w-16">启用</th>
                      <th className="text-left px-4 py-2 text-xs font-medium text-gray-500">技能名称</th>
                      <th className="text-left px-4 py-2 text-xs font-medium text-gray-500">描述</th>
                    </tr>
                  </thead>
                  <tbody>
                    {availableSkills.map((skill, idx) => {
                      const enabledSkills = form.skills?.enabledSkills
                      const disabledSkills = form.skills?.disabledSkills
                      // 如果 enabledSkills 有内容，则仅白名单中的技能启用
                      // 否则默认启用（除非在 disabledSkills 中）
                      const isEnabled = enabledSkills && enabledSkills.length > 0
                        ? enabledSkills.includes(skill.name)
                        : !(disabledSkills ?? []).includes(skill.name)

                      const handleToggle = () => {
                        const currentEnabled = form.skills?.enabledSkills ?? []
                        const currentDisabled = form.skills?.disabledSkills ?? []

                        if (enabledSkills && enabledSkills.length > 0) {
                          // 白名单模式
                          const newEnabled = isEnabled
                            ? currentEnabled.filter(n => n !== skill.name)
                            : [...currentEnabled, skill.name]
                          updateField('skills', { enabledSkills: newEnabled })
                        } else {
                          // 黑名单模式
                          const newDisabled = isEnabled
                            ? [...currentDisabled, skill.name]
                            : currentDisabled.filter(n => n !== skill.name)
                          updateField('skills', { disabledSkills: newDisabled })
                        }
                      }

                      return (
                        <tr key={skill.id} className={`border-b border-gray-100 hover:bg-gray-50 ${idx % 2 === 1 ? 'bg-gray-50/50' : ''}`}>
                          <td className="px-4 py-2.5">
                            <Switch
                              isSelected={isEnabled}
                              onChange={handleToggle}
                            >
                              <Switch.Content>
                                <Switch.Control>
                                  <Switch.Thumb />
                                </Switch.Control>
                              </Switch.Content>
                            </Switch>
                          </td>
                          <td className="px-4 py-2.5 font-medium text-gray-800">{skill.name}</td>
                          <td className="px-4 py-2.5 text-gray-500 truncate max-w-xs">{skill.description || '-'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <hr className="border-gray-100" />

          {/* V32: 定时调度配置 */}
          <section>
            <h3 className="text-sm font-semibold text-gray-800 mb-3">定时触发</h3>
            <p className="text-xs text-gray-400 mb-3">
              配置定时任务让 QQ 智能体在指定时间自动触发。需要先绑定 QQ 账号并启用 QQ 智能体。
            </p>
            <ScheduleSection
              schedule={form.schedule}
              onChange={(schedule) => updateField('schedule', schedule)}
            />
          </section>

          <hr className="border-gray-100" />

          {/* V26: 预编译系统提示词预览 */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-800">系统提示词</h3>
              {currentAgent?.compiledPrompt && (
                <span className="text-xs text-gray-400">
                  创建/更新时自动编译，运行时直接使用
                </span>
              )}
            </div>
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
              {currentAgent?.compiledPrompt ? (
                <pre className="text-xs text-gray-700 whitespace-pre-wrap font-mono leading-relaxed max-h-96 overflow-y-auto">
                  {currentAgent.compiledPrompt}
                </pre>
              ) : (
                <div className="text-sm text-gray-400 text-center py-4">
                  {agentId
                    ? '保存配置后将自动生成系统提示词'
                    : '创建智能体后将在运行时自动生成系统提示词'}
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

export default AgentConfigForm