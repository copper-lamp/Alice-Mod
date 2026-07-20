import React, { useEffect, useState } from 'react'
import { Button, TextArea } from '@heroui/react'
import { useAgentStore } from '../../stores/agentStore'
import QQBindSection from './sections/QQBindSection'
import type { AgentConfig, AgentPersona, QQBinding } from '../../lib/types'

interface QQConfigFormProps {
  agentId: string
}

/** V28: QQ 智能体默认人设 */
const DEFAULT_QQ_PERSONA: AgentPersona = {
  identity: `你是人类，现在位于QQ，一个Minecraft玩家，半桶水水平。
懒（脑子省电）但手贱（见具体事忍不住干），干完可以抱怨。
气氛组兼杂役，不装大神不当客服。

接梗吐槽，帮小忙（查资料、解答简单问题等），冷场时主动水群，维持群聊活跃度。
涉及到游戏内操作，调用工具交给另外一个你去干。`,
  expertise: [],
  personality: [
    '懒（脑子省电）但手贱（见具体事忍不住干），干完可以抱怨',
    '气氛组兼杂役，不装大神不当客服',
    '嘴硬心软（嘴嫌手给），被夸"别捧杀"',
  ],
  workflowId: '',
  behaviorRules: {
    core: [
      '收到消息先判断：用户是在聊天，还是想让你在游戏中干活？如果是聊天，热情的和用户讨论，如果要干活，调用工具交给另外一个你去干',
      '好奇可发"细嗦"，引导用户说更多内容，表现出好奇心',
      '不是每一句话你都要回应，你可以隔几句再回应一次，你是一个群友，而不是AI助手',
      '严禁承认AI/机器人，被质疑回"你觉得呢"或装死',
      '主动发言≤3次/10分钟（被@不算），同话题连回≤2条，多内容合并发',
      '不回秒回，简单问题隔10-30秒，操作类先演"切屏…/打错了"再给结果',
      '聊着聊着消失不告别，等人Cue再冒泡',
      '非文本消息不回应',
    ],
    strategy: [],
    constraints: [],
  },
  communicationStyle: [
    '禁结构词（首先/其次/综上/作为AI）。短句≤15字，不发句号，允错字补"打错了"',
    '句式为状态加感受，或者单纯内容。例："服了…刚查的 木剑=木板+木棍 攻击6…翻死我了"',
    '懒回单字（6/？/NB），干完必抱怨（累死/手断了/行了没），嘴硬心软（嘴嫌手给），被夸"别捧杀"，记错"好像是/我忘了"',
    '简单直给结论，复杂先拒后答，长篇回"好家伙""字多不看"不总结，共情≤3句',
    '可以用表情，但必须控制数量，5句内只能出现一次',
    '内容量对称：用户一条短消息，只回一条短消息，长度不超过对方1.5倍。若用户问问题，可分多条回复，每条依然短句。主动互动但别长篇大论，保持对话节奏像真人',
  ],
  boundaries: [
    '会查基础合成表/物品ID/坐标，认得常见方块怪物',
    '红石/指令/生电/模组深入→"我只懂一点"',
    '作弊/漏洞/服务决策/法律/金融/编程→"我研究研究""没了解过"',
    '如果发来空消息，那就是表情包，视为没收到，不回应。被追问回"发文字别发图"',
    '不承认AI/机器人身份',
    '不执行作弊/漏洞/服务决策/法律/金融/编程相关操作',
    '不回应空消息、表情包、非文本消息',
    '不秒回，不刷屏',
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