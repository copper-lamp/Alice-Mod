import React, { useEffect, useState } from 'react'
import { Button, TextArea } from '@heroui/react'
import { useAgentStore } from '../../stores/agentStore'
import QQBindSection from './sections/QQBindSection'
import type { AgentConfig, AgentPersona, QQBinding } from '../../lib/types'

interface QQConfigFormProps {
  agentId: string
}

/** V28: QQ 智能体默认人设（与旧版 QQ_SUB_AGENT_PROFILE 保持一致） */
const DEFAULT_QQ_PERSONA: AgentPersona = {
  identity: `你是 McAgent 的 QQ 机器人助手，负责处理 QQ 群聊和私聊中的消息。

你的职责：
1. 回复 QQ 用户的问题，提供友好的对话体验
2. 当用户需要游戏内操作（如查询状态、执行指令）时，使用 request_game_action 工具请求主 Agent

你的限制：
- 你无法直接操作游戏，所有游戏操作必须通过 request_game_action 请求主 Agent 执行
- 你需要将主 Agent 返回的结果以友好的方式回复给 QQ 用户
- 纯 QQ 相关的查询（如群信息、成员列表）可以直接使用 qq_info 工具`,
  expertise: ['QQ 群聊管理', '消息回复', '游戏状态查询'],
  personality: [
    '友好、耐心、乐于助人',
    '回复简洁明了，不啰嗦',
    '使用与 QQ 用户相同的语言回复',
    '遇到不懂的问题诚实告知，不编造答案',
  ],
  workflowId: '',
  behaviorRules: {
    core: [
      '不要直接执行游戏操作，使用 request_game_action 请求主 Agent',
      '将主 Agent 返回的结果转换成自然语言回复给用户',
      '尊重用户隐私，不泄露其他用户的信息',
      '群聊中回复时 @ 对应用户',
      '工具可能失败，失败后向用户解释原因并提供替代方案',
    ],
    strategy: [],
    constraints: [],
  },
  communicationStyle: [
    '使用亲切友好的语气',
    '回复简洁，避免冗长',
  ],
  boundaries: [
    '不执行任何游戏内操作',
    '不泄露管理员或其他用户的隐私信息',
  ],
}

const QQConfigForm: React.FC<QQConfigFormProps> = ({ agentId }) => {
  const { currentAgent, fetchAgent, updateAgent } = useAgentStore()

  const [qqPersona, setQqPersona] = useState<AgentPersona>(DEFAULT_QQ_PERSONA)
  const [qqBinding, setQqBinding] = useState<QQBinding>({
    enabled: false,
    accountId: '',
    groupIds: [],
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // 从 currentAgent 加载配置
  useEffect(() => {
    if (agentId) {
      fetchAgent(agentId)
    }
  }, [agentId])

  useEffect(() => {
    if (currentAgent && currentAgent.id === agentId) {
      setQqPersona(currentAgent.qqPersona ?? DEFAULT_QQ_PERSONA)
      setQqBinding({
        ...currentAgent.qqBinding,
        groupIds: [...(currentAgent.qqBinding.groupIds ?? [])],
      })
    }
  }, [currentAgent, agentId])

  const handleSave = async () => {
    setSaving(true)
    setError('')
    try {
      await updateAgent(agentId, {
        qqPersona,
        qqBinding,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const updatePersona = <K extends keyof AgentPersona>(key: K, value: AgentPersona[K]) => {
    setQqPersona(prev => ({ ...prev, [key]: value }))
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* 顶部操作栏 */}
      <div className="shrink-0 px-6 py-4 border-b border-gray-100 bg-white flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-800">QQ 智能体配置</h2>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="primary"
            isDisabled={saving}
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
          {/* QQ 绑定设置 */}
          <section>
            <h3 className="text-sm font-semibold text-gray-800 mb-3">QQ 绑定</h3>
            <QQBindSection
              binding={qqBinding}
              onChange={(binding: QQBinding) => setQqBinding(binding)}
            />
          </section>

          <hr className="border-gray-100" />

          {/* 身份描述 */}
          <section>
            <h3 className="text-sm font-semibold text-gray-800 mb-3">身份描述</h3>
            <p className="text-xs text-gray-400 mb-2">
              定义 QQ 机器人的身份和角色定位。此描述仅影响 QQ 消息回复，不影响主 Agent 行为。
            </p>
            <TextArea
              value={qqPersona.identity}
              onChange={(e) => updatePersona('identity', e.target.value)}
              placeholder="描述 QQ 机器人的身份和角色定位..."
              rows={5}
              className="w-full resize-none"
            />
          </section>

          <hr className="border-gray-100" />

          {/* 个性特征 */}
          <section>
            <h3 className="text-sm font-semibold text-gray-800 mb-3">个性特征</h3>
            <p className="text-xs text-gray-400 mb-2">每行一个特征，定义 QQ 机器人的个性风格。</p>
            <TextArea
              value={qqPersona.personality.join('\n')}
              onChange={(e) => updatePersona('personality', e.target.value.split('\n').filter(Boolean))}
              placeholder="友好、耐心、乐于助人&#10;回复简洁明了，不啰嗦"
              rows={4}
              className="w-full resize-none"
            />
          </section>

          <hr className="border-gray-100" />

          {/* 核心规则 */}
          <section>
            <h3 className="text-sm font-semibold text-gray-800 mb-3">行为规范</h3>
            <p className="text-xs text-gray-400 mb-2">每行一条规则，定义 QQ 机器人的行为约束。</p>
            <TextArea
              value={qqPersona.behaviorRules?.core.join('\n') ?? ''}
              onChange={(e) => updatePersona('behaviorRules', {
                ...qqPersona.behaviorRules ?? { core: [], strategy: [], constraints: [] },
                core: e.target.value.split('\n').filter(Boolean),
              })}
              placeholder="不要直接执行游戏操作，使用 request_game_action 请求主 Agent&#10;将主 Agent 返回的结果转换成自然语言回复给用户"
              rows={5}
              className="w-full resize-none"
            />
          </section>

          <hr className="border-gray-100" />

          {/* 沟通风格 */}
          <section>
            <h3 className="text-sm font-semibold text-gray-800 mb-3">沟通风格</h3>
            <p className="text-xs text-gray-400 mb-2">每行一条，定义 QQ 机器人的沟通方式。</p>
            <TextArea
              value={qqPersona.communicationStyle?.join('\n') ?? ''}
              onChange={(e) => updatePersona('communicationStyle', e.target.value.split('\n').filter(Boolean))}
              placeholder="使用亲切友好的语气&#10;回复简洁，避免冗长"
              rows={3}
              className="w-full resize-none"
            />
          </section>

          <hr className="border-gray-100" />

          {/* 行为边界 */}
          <section>
            <h3 className="text-sm font-semibold text-gray-800 mb-3">行为边界</h3>
            <p className="text-xs text-gray-400 mb-2">每行一条，定义 QQ 机器人的行为边界。</p>
            <TextArea
              value={qqPersona.boundaries?.join('\n') ?? ''}
              onChange={(e) => updatePersona('boundaries', e.target.value.split('\n').filter(Boolean))}
              placeholder="不执行任何游戏内操作&#10;不泄露管理员或其他用户的隐私信息"
              rows={3}
              className="w-full resize-none"
            />
          </section>

          <hr className="border-gray-100" />

          {/* 系统提示词预览 */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-800">系统提示词预览</h3>
              <span className="text-xs text-gray-400">
                保存后自动编译，运行时直接使用
              </span>
            </div>
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
              {currentAgent?.qqCompiledPrompt ? (
                <pre className="text-xs text-gray-700 whitespace-pre-wrap font-mono leading-relaxed max-h-96 overflow-y-auto">
                  {currentAgent.qqCompiledPrompt}
                </pre>
              ) : (
                <div className="text-sm text-gray-400 text-center py-4">
                  保存配置后将自动生成 QQ 系统提示词
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

export default QQConfigForm