import React, { useEffect, useState } from 'react'
import { Button, Select, ListBox } from '@heroui/react'
import { useAgentStore } from '../../stores/agentStore'
import { useModelStore } from '../../stores/modelStore'
import { useUIStore } from '../../stores/uiStore'
import type { AgentConfig, ExecutionRule, QQBinding, AgentSchedule, AgentIdentity, AgentMemoryConfig } from '../../lib/types'
import BasicInfoSection from './sections/BasicInfoSection'
import IdentitySection from './sections/IdentitySection'
import ToolConfigSection from './sections/ToolConfigSection'
import MemoryConfigSection from './sections/MemoryConfigSection'
import ExecutionRulesSection from './sections/ExecutionRulesSection'
import QQBindSection from './sections/QQBindSection'
import ScheduleSection from './sections/ScheduleSection'

interface AgentConfigFormProps {
  agentId?: string
}

const defaultConfig: AgentConfig = {
  name: '',
  identity: { selectedFragments: [], customPrompt: '' },
  tools: { categorySelection: {} },
  memory: { mode: 'both' },
  executionRules: [],
  qqBinding: { enabled: false, accountId: '', groupIds: [] },
  schedule: { mode: 'always' }
}

const AgentConfigForm: React.FC<AgentConfigFormProps> = ({ agentId }) => {
  const { createAgent, updateAgent, fetchAgent, currentAgent } = useAgentStore()
  const { models, fetchModels } = useModelStore()
  const { setLayoutMode, navigateToAgent, setActiveNav } = useUIStore()

  const [form, setForm] = useState<AgentConfig>(defaultConfig)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>('')

  // 加载可用模型列表
  useEffect(() => {
    fetchModels()
  }, [fetchModels])

  // 编辑模式：加载智能体数据
  useEffect(() => {
    if (agentId) {
      fetchAgent(agentId)
    }
  }, [agentId])

  useEffect(() => {
    if (agentId && currentAgent && currentAgent.id === agentId) {
      setForm({
        name: currentAgent.name,
        skinData: currentAgent.skinData,
        modelId: currentAgent.modelId,
        identity: { ...currentAgent.identity },
        tools: { ...currentAgent.tools, categorySelection: { ...currentAgent.tools.categorySelection } },
        memory: { ...currentAgent.memory },
        executionRules: currentAgent.executionRules.map(r => ({ ...r })),
        qqBinding: { ...currentAgent.qqBinding, groupIds: [...(currentAgent.qqBinding.groupIds ?? [])] },
        schedule: { ...currentAgent.schedule }
      })
    }
  }, [agentId, currentAgent])

  const handleSave = async () => {
    setSaving(true)
    setError('')
    try {
      if (agentId) {
        await updateAgent(agentId, form)
        setLayoutMode('agent-view')
      } else {
        const id = await createAgent(form)
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
    <div className="flex flex-col h-full">
      {/* 顶部操作栏 */}
      <div className="flex items-center justify-between mb-6 shrink-0">
        <h2 className="text-lg font-semibold text-gray-800">
          {agentId ? '编辑智能体' : '创建智能体'}
        </h2>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onPress={handleCancel}>
            取消
          </Button>
          <Button
            size="sm"
            isDisabled={saving || !form.name.trim() || !form.modelId}
            isPending={saving}
            onPress={handleSave}
          >
            {saving ? '保存中...' : '保存'}
          </Button>
        </div>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-600">
          {error}
        </div>
      )}

      {/* 表单内容 - 留白优化 */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto space-y-8 pb-8">
          {/* 1. 基本信息 */}
          <section>
            <h3 className="text-sm font-semibold text-gray-800 mb-3">基本信息</h3>
            <BasicInfoSection
              name={form.name}
              skinData={form.skinData}
              onChange={(name, skinData) => {
                setForm(prev => ({ ...prev, name, skinData }))
              }}
            />
          </section>

          <hr className="border-gray-100" />

          {/* 2. 模型选择 */}
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
              selectedKey={form.modelId}
              onSelectionChange={(key) => {
                if (key) {
                  updateField('modelId', key.toString())
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

          {/* 3. 身份配置 */}
          <section>
            <h3 className="text-sm font-semibold text-gray-800 mb-3">身份配置</h3>
            <IdentitySection
              selectedFragments={form.identity.selectedFragments}
              customPrompt={form.identity.customPrompt}
              onChange={(identity: AgentIdentity) => updateField('identity', identity)}
            />
          </section>

          <hr className="border-gray-100" />

          {/* 3. 工具配置 */}
          <section>
            <h3 className="text-sm font-semibold text-gray-800 mb-3">工具配置</h3>
            <ToolConfigSection
              selection={form.tools.categorySelection}
              onChange={(selection) => updateField('tools', { ...form.tools, categorySelection: selection })}
            />
          </section>

          <hr className="border-gray-100" />

          {/* 4. 记忆配置 */}
          <section>
            <h3 className="text-sm font-semibold text-gray-800 mb-3">记忆配置</h3>
            <MemoryConfigSection
              mode={form.memory.mode}
              onChange={(mode: AgentMemoryConfig['mode']) => updateField('memory', { mode })}
            />
          </section>

          <hr className="border-gray-100" />

          {/* 5. 执行规则 */}
          <section>
            <h3 className="text-sm font-semibold text-gray-800 mb-3">执行规则</h3>
            <ExecutionRulesSection
              rules={form.executionRules}
              onChange={(rules: ExecutionRule[]) => updateField('executionRules', rules)}
            />
          </section>

          <hr className="border-gray-100" />

          {/* 6. QQ 绑定 */}
          <section>
            <h3 className="text-sm font-semibold text-gray-800 mb-3">QQ 绑定</h3>
            <QQBindSection
              binding={form.qqBinding}
              onChange={(binding: QQBinding) => updateField('qqBinding', binding)}
            />
          </section>

          <hr className="border-gray-100" />

          {/* 7. 定时启用 */}
          <section>
            <h3 className="text-sm font-semibold text-gray-800 mb-3">定时启用</h3>
            <ScheduleSection
              schedule={form.schedule}
              onChange={(schedule: AgentSchedule) => updateField('schedule', schedule)}
            />
          </section>
        </div>
      </div>
    </div>
  )
}

export default AgentConfigForm