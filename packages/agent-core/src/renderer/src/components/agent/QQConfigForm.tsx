import React, { useEffect, useState, useCallback } from 'react'
import { Button, TextArea, Select, ListBox, Tooltip, Switch, Checkbox, RadioGroup, Radio } from '@heroui/react'
import { RefreshCw, ChevronRight, AlertTriangle, Eye, EyeOff, ExternalLink, Settings, Clock, Wrench, BookOpen, Star, FileText, Construction } from 'lucide-react'
import { useAgentStore } from '../../stores/agentStore'
import QQBindSection from './sections/QQBindSection'
import type { AgentConfig, AgentPersona, QQBinding, AgentSchedule, QQAgentToolConfig, QQAgentSkillConfig } from '../../lib/types'

// ════════════════════════════════════════════════════════════════
// 常量
// ════════════════════════════════════════════════════════════════

/** 分区定义 */
const SECTIONS = [
  { id: 'basic', label: '基本', icon: Settings },
  { id: 'timing', label: '定时', icon: Clock },
  { id: 'tools', label: '工具', icon: Wrench },
  { id: 'skills', label: '技能', icon: BookOpen },
  { id: 'preferences', label: '偏好', icon: Star },
  { id: 'prompt', label: '设定', icon: FileText },
] as const

type SectionId = typeof SECTIONS[number]['id']

/** 默认 QQ 工具配置 */
const DEFAULT_QQ_TOOLS: QQAgentToolConfig = { independent: false, enabledTools: {} }

/** 默认 QQ 技能配置 */
const DEFAULT_QQ_SKILLS: QQAgentSkillConfig = { independent: false }

// ════════════════════════════════════════════════════════════════
// 工具类型
// ════════════════════════════════════════════════════════════════

interface ToolItem {
  name: string
  displayName: string
  description: string
  category: string
  categoryLabel: string
  parameters: Array<{ name: string; type: string; description: string; required: boolean }>
  example?: string
}

// ════════════════════════════════════════════════════════════════
// 组件
// ════════════════════════════════════════════════════════════════

interface QQConfigFormProps {
  agentId: string
}

const QQConfigForm: React.FC<QQConfigFormProps> = ({ agentId }) => {
  const { currentAgent, fetchAgent, updateAgent } = useAgentStore()

  // ── 表单状态 ──
  const [activeSection, setActiveSection] = useState<SectionId>('basic')
  const [defaultPersona, setDefaultPersona] = useState<{ prompt: string } | null>(null)
  const [qqPersona, setQqPersona] = useState<AgentPersona>(() => ({
    identity: '',
    expertise: [],
    personality: [],
    workflowId: '',
  }))
  const [qqBinding, setQqBinding] = useState<QQBinding>({ enabled: false, accountId: '', groupIds: [] })
  const [schedule, setSchedule] = useState<AgentSchedule | undefined>(undefined)
  const [qqTools, setQqTools] = useState<QQAgentToolConfig>(DEFAULT_QQ_TOOLS)
  const [qqSkills, setQqSkills] = useState<QQAgentSkillConfig>(DEFAULT_QQ_SKILLS)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // ── 工具列表 ──
  const [tools, setTools] = useState<ToolItem[]>([])
  const [toolsLoading, setToolsLoading] = useState(false)
  const [toolsRefreshing, setToolsRefreshing] = useState(false)
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set())

  // ── 技能列表 ──
  const [availableSkills, setAvailableSkills] = useState<Array<{ id: string; name: string; description: string }>>([])

  // ── 系统提示词编辑弹窗 ──
  const [showPromptEditor, setShowPromptEditor] = useState(false)
  const [promptEditText, setPromptEditText] = useState('')
  const [promptEditConfirmed, setPromptEditConfirmed] = useState(false)

  // ── 加载工具列表 ──
  const loadTools = useCallback(async (isRefresh = false) => {
    if (isRefresh) setToolsRefreshing(true)
    else setToolsLoading(true)
    try {
      const result = await window.electronAPI.invoke('tool:list-all') as ToolItem[]
      setTools(result)
    } catch (err) {
      console.error('加载工具列表失败:', err)
    } finally {
      setToolsLoading(false)
      setToolsRefreshing(false)
    }
  }, [])

  // ── 加载技能列表 ──
  const loadSkills = useCallback(async () => {
    try {
      const result = await window.electronAPI.invoke('memory:list', { type: 'skill', limit: 100 }) as any
      const skills = (result.memories ?? []).map((m: any) => {
        const c = (m.content as Record<string, unknown>) ?? {}
        return {
          id: m.id ?? '',
          name: (c.name as string) ?? '',
          description: (c.description as string) ?? '',
        }
      })
      setAvailableSkills(skills)
    } catch {
      // 技能列表加载失败不影响主体功能
    }
  }, [])

  // ── 初始化加载 ──
  useEffect(() => {
    if (agentId) fetchAgent(agentId)
    loadTools()
    loadSkills()
    // 从后端 JSON 加载默认 QQ 人设
    window.electronAPI.invoke('prompt:get-default-qq-persona').then((persona: any) => {
      setDefaultPersona(persona as { prompt: string })
    }).catch(err => {
      console.error('加载默认 QQ 人设失败:', err)
    })
  }, [agentId])

  // ── 从 currentAgent 加载配置 ──
  useEffect(() => {
    if (currentAgent && currentAgent.id === agentId) {
      setQqPersona(currentAgent.qqPersona ?? { identity: '', expertise: [], personality: [], workflowId: '' })
      setQqBinding({
        ...currentAgent.qqBinding,
        groupIds: [...(currentAgent.qqBinding.groupIds ?? [])],
      })
      setSchedule(currentAgent.schedule ?? undefined)
      setQqTools(currentAgent.qqTools ?? DEFAULT_QQ_TOOLS)
      setQqSkills(currentAgent.qqSkills ?? DEFAULT_QQ_SKILLS)
    }
  }, [currentAgent, agentId])

  // ── 保存 ──
  const handleSave = async () => {
    setSaving(true)
    setError('')
    try {
      await updateAgent(agentId, {
        qqPersona,
        qqBinding,
        schedule,
        qqTools,
        qqSkills,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  // ── 人设更新 ──
  const updatePersona = <K extends keyof AgentPersona>(key: K, value: AgentPersona[K]) => {
    setQqPersona(prev => ({ ...prev, [key]: value }))
  }

  // ── 工具切换 ──
  const toggleTool = (toolName: string) => {
    const current = qqTools.enabledTools ?? {}
    setQqTools({
      ...qqTools,
      independent: true,
      enabledTools: { ...current, [toolName]: !current[toolName] },
    })
  }

  const toggleAllTools = () => {
    const current = qqTools.enabledTools ?? {}
    const allEnabled = tools.every(t => current[t.name])
    const newEnabled: Record<string, boolean> = {}
    tools.forEach(t => { newEnabled[t.name] = !allEnabled })
    setQqTools({ ...qqTools, independent: true, enabledTools: newEnabled })
  }

  const resetToMainTools = () => {
    setQqTools(DEFAULT_QQ_TOOLS)
  }

  const enabledToolCount = qqTools.independent
    ? Object.values(qqTools.enabledTools ?? {}).filter(Boolean).length
    : 0

  // ── 技能切换 ──
  const toggleSkill = (skillName: string) => {
    const currentEnabled = qqSkills.enabledSkills ?? []
    const isEnabled = qqSkills.independent
      ? currentEnabled.includes(skillName)
      : true // 跟随主 Agent 时默认启用

    if (!qqSkills.independent) {
      // 首次切换时进入独立模式，只保留当前技能为启用
      setQqSkills({ independent: true, enabledSkills: [skillName] })
    } else {
      const newEnabled = isEnabled
        ? currentEnabled.filter(n => n !== skillName)
        : [...currentEnabled, skillName]
      setQqSkills({ ...qqSkills, enabledSkills: newEnabled })
    }
  }

  const resetToMainSkills = () => {
    setQqSkills(DEFAULT_QQ_SKILLS)
  }

  // ── 工具分组 ──
  const grouped = tools.reduce<Record<string, ToolItem[]>>((acc, tool) => {
    if (!acc[tool.category]) acc[tool.category] = []
    acc[tool.category].push(tool)
    return acc
  }, {})

  // ── 渲染导航侧边栏 ──
  const renderSidebar = () => (
    <nav className="w-44 shrink-0 border-r border-gray-200 bg-gray-50/50 flex flex-col py-4">
      {SECTIONS.map(section => (
        <button
          key={section.id}
          onClick={() => setActiveSection(section.id)}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm text-left transition-colors ${
            activeSection === section.id
              ? 'bg-blue-50 text-blue-700 font-medium border-r-2 border-blue-500'
              : 'text-gray-600 hover:bg-gray-100 hover:text-gray-800'
          }`}
        >
          <section.icon size={16} className="text-gray-500 shrink-0" />
          <span>{section.label}</span>
          {activeSection === section.id && (
            <ChevronRight size={14} className="ml-auto text-blue-400" />
          )}
        </button>
      ))}
    </nav>
  )

  // ── 渲染各分区内容 ──
  const renderSection = () => {
    switch (activeSection) {
      case 'basic': return renderBasicSection()
      case 'timing': return renderTimingSection()
      case 'tools': return renderToolsSection()
      case 'skills': return renderSkillsSection()
      case 'preferences': return renderPreferencesSection()
      case 'prompt': return renderPromptSection()
    }
  }

  // ══════════════════════════════════════════════════════════════
  // 基本
  // ══════════════════════════════════════════════════════════════
  const renderBasicSection = () => (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-gray-800 mb-1">QQ 绑定</h3>
        <p className="text-xs text-gray-400 mb-3">绑定 QQ 账号和群组，使智能体能够接入 QQ 消息。</p>
        <QQBindSection
          binding={qqBinding}
          onChange={(binding: QQBinding) => setQqBinding(binding)}
        />
      </div>
    </div>
  )

  // ══════════════════════════════════════════════════════════════
  // 定时
  // ══════════════════════════════════════════════════════════════
  const renderTimingSection = () => {
    const safe = schedule ?? { mode: 'disabled' as const, timezone: 'Asia/Shanghai' }
    const updateSchedule = (patch: Partial<AgentSchedule>) => {
      setSchedule({ ...safe, ...patch })
    }

    const TIMEZONE_OPTIONS = [
      { value: 'Asia/Shanghai', label: '亚洲/上海 (UTC+8)' },
      { value: 'Asia/Tokyo', label: '亚洲/东京 (UTC+9)' },
      { value: 'America/New_York', label: '美洲/纽约 (UTC-5)' },
      { value: 'America/Los_Angeles', label: '美洲/洛杉矶 (UTC-8)' },
      { value: 'Europe/London', label: '欧洲/伦敦 (UTC+0)' },
      { value: 'Europe/Berlin', label: '欧洲/柏林 (UTC+1)' },
      { value: 'Australia/Sydney', label: '澳大利亚/悉尼 (UTC+11)' },
      { value: 'UTC', label: 'UTC (协调世界时)' },
    ]

    return (
      <div className="space-y-6">
        <div>
          <h3 className="text-sm font-semibold text-gray-800 mb-1">定时触发</h3>
          <p className="text-xs text-gray-400 mb-3">
            配置定时任务让 QQ 智能体在指定时间自动触发。需要先绑定 QQ 账号并启用 QQ 智能体。
          </p>
        </div>

        <RadioGroup value={safe.mode} onChange={(val) => {
          if (val === 'disabled') {
            setSchedule(undefined)
          } else {
            updateSchedule({ mode: val as 'cron' | 'interval' | 'random' })
          }
        }}>
          <Radio value="disabled" className="border-border group cursor-pointer rounded-lg border-2 p-3 hover:border-blue-300 data-[selected=true]:border-blue-500">
            <Radio.Content>
              <Radio.Control><Radio.Indicator /></Radio.Control>
              关闭定时触发
            </Radio.Content>
          </Radio>
          <Radio value="cron" className="border-border group cursor-pointer rounded-lg border-2 p-3 hover:border-blue-300 data-[selected=true]:border-blue-500">
            <Radio.Content>
              <Radio.Control><Radio.Indicator /></Radio.Control>
              Cron 表达式
            </Radio.Content>
          </Radio>
          <Radio value="interval" className="border-border group cursor-pointer rounded-lg border-2 p-3 hover:border-blue-300 data-[selected=true]:border-blue-500">
            <Radio.Content>
              <Radio.Control><Radio.Indicator /></Radio.Control>
              固定间隔
            </Radio.Content>
          </Radio>
          <Radio value="random" className="border-border group cursor-pointer rounded-lg border-2 p-3 hover:border-blue-300 data-[selected=true]:border-blue-500">
            <Radio.Content>
              <Radio.Control><Radio.Indicator /></Radio.Control>
              随机时段
            </Radio.Content>
          </Radio>
        </RadioGroup>

        {safe.mode === 'cron' && (
          <div className="space-y-3 pl-1">
            <div>
              <label className="text-xs text-gray-500 font-medium mb-1 block">Cron 表达式</label>
              <input
                type="text"
                value={safe.cronExpression ?? ''}
                onChange={e => updateSchedule({ cronExpression: e.target.value })}
                placeholder="例如: 0 */30 * * * * (每30分钟), 0 9 * * * (每天9点)"
                className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400 bg-white"
              />
              <p className="text-xs text-gray-400 mt-1">
                格式: 秒 分 时 日 月 周，例如 <code className="bg-gray-100 px-1 rounded">0 0 9 * * *</code> 每天9点
              </p>
            </div>
            <TimingCommonFields schedule={safe} onUpdate={updateSchedule} timezoneOptions={TIMEZONE_OPTIONS} />
          </div>
        )}

        {safe.mode === 'interval' && (
          <div className="space-y-3 pl-1">
            <div>
              <label className="text-xs text-gray-500 font-medium mb-1 block">间隔时间（秒）</label>
              <input
                type="number"
                min={10}
                value={safe.intervalSeconds ?? 300}
                onChange={e => updateSchedule({ intervalSeconds: Math.max(10, parseInt(e.target.value) || 300) })}
                className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400 bg-white"
              />
              <p className="text-xs text-gray-400 mt-1">最小间隔 10 秒，建议 60 秒以上</p>
            </div>
            <TimingCommonFields schedule={safe} onUpdate={updateSchedule} timezoneOptions={TIMEZONE_OPTIONS} />
          </div>
        )}

        {safe.mode === 'random' && (
          <div className="space-y-3 pl-1">
            <div>
              <label className="text-xs text-gray-500 font-medium mb-1 block">每日随机时段</label>
              <div className="flex items-center gap-2">
                <input
                  type="time"
                  value={safe.randomPeriod?.timeWindow?.[0] ?? '08:00'}
                  onChange={e => updateSchedule({
                    randomPeriod: {
                      timeWindow: [e.target.value, safe.randomPeriod?.timeWindow?.[1] ?? '18:00'],
                      minTimes: safe.randomPeriod?.minTimes ?? 1,
                      maxTimes: safe.randomPeriod?.maxTimes ?? 3,
                    },
                  })}
                  className="px-3 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:border-blue-400 bg-white"
                />
                <span className="text-gray-400">至</span>
                <input
                  type="time"
                  value={safe.randomPeriod?.timeWindow?.[1] ?? '18:00'}
                  onChange={e => updateSchedule({
                    randomPeriod: {
                      timeWindow: [safe.randomPeriod?.timeWindow?.[0] ?? '08:00', e.target.value],
                      minTimes: safe.randomPeriod?.minTimes ?? 1,
                      maxTimes: safe.randomPeriod?.maxTimes ?? 3,
                    },
                  })}
                  className="px-3 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:border-blue-400 bg-white"
                />
              </div>
              <p className="text-xs text-gray-400 mt-1">在此时段内随机触发</p>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <label className="text-xs text-gray-500 font-medium mb-1 block">最少触发次数</label>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={safe.randomPeriod?.minTimes ?? 1}
                  onChange={e => updateSchedule({
                    randomPeriod: {
                      timeWindow: safe.randomPeriod?.timeWindow ?? ['08:00', '18:00'],
                      minTimes: Math.max(1, parseInt(e.target.value) || 1),
                      maxTimes: safe.randomPeriod?.maxTimes ?? 3,
                    },
                  })}
                  className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:border-blue-400 bg-white"
                />
              </div>
              <div className="flex-1">
                <label className="text-xs text-gray-500 font-medium mb-1 block">最多触发次数</label>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={safe.randomPeriod?.maxTimes ?? 3}
                  onChange={e => updateSchedule({
                    randomPeriod: {
                      timeWindow: safe.randomPeriod?.timeWindow ?? ['08:00', '18:00'],
                      minTimes: safe.randomPeriod?.minTimes ?? 1,
                      maxTimes: Math.max(1, parseInt(e.target.value) || 3),
                    },
                  })}
                  className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:border-blue-400 bg-white"
                />
              </div>
            </div>
            <TimingCommonFields schedule={safe} onUpdate={updateSchedule} timezoneOptions={TIMEZONE_OPTIONS} />
          </div>
        )}
      </div>
    )
  }

  // ══════════════════════════════════════════════════════════════
  // 工具
  // ══════════════════════════════════════════════════════════════
  const renderToolsSection = () => (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-gray-800 mb-1">工具配置</h3>
        <p className="text-xs text-gray-400 mb-3">
          按个启停 QQ 智能体可用的工具。默认跟随主 Agent 配置，开启独立配置后可单独控制。
        </p>
      </div>

      {/* 独立开关 */}
      <div className="flex items-center gap-2">
        <Switch
          isSelected={qqTools.independent}
          onChange={(val) => {
            if (val) {
              // 从主 Agent 复制当前工具配置
              const mainTools = currentAgent?.tools?.enabledTools ?? {}
              setQqTools({ independent: true, enabledTools: { ...mainTools } })
            } else {
              resetToMainTools()
            }
          }}
        >
          <Switch.Content>
            <Switch.Control>
              <Switch.Thumb />
            </Switch.Control>
          </Switch.Content>
        </Switch>
        <span className="text-sm text-gray-700 select-none">独立配置（不与主 Agent 同步）</span>
      </div>

      {qqTools.independent ? (
        <>
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-500">
              已启用: <strong className="text-gray-700">{enabledToolCount}</strong>/{tools.length}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => loadTools(true)}
                disabled={toolsRefreshing}
                className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-blue-600 disabled:opacity-50 transition-colors"
                title="重新加载工具列表"
              >
                <RefreshCw size={12} className={toolsRefreshing ? 'animate-spin' : ''} />
                {toolsRefreshing ? '刷新中...' : '刷新'}
              </button>
              <button onClick={toggleAllTools} className="text-xs text-blue-600 hover:text-blue-700">
                {enabledToolCount === tools.length ? '取消全选' : '全选'}
              </button>
              <button onClick={resetToMainTools} className="text-xs text-gray-500 hover:text-gray-700">
                取消独立
              </button>
            </div>
          </div>

          {toolsLoading ? (
            <div className="text-sm text-gray-400 text-center py-8">加载工具列表...</div>
          ) : tools.length === 0 ? (
            <div className="text-sm text-gray-400 text-center py-8">
              暂无已注册工具，请先连接 Adapter Core
            </div>
          ) : (
            <div className="space-y-3">
              {Object.entries(grouped).map(([category, categoryTools]) => (
                <div key={category} className="border border-gray-200 rounded-lg overflow-hidden">
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
                  {!collapsedCategories.has(category) && (
                    <div className="divide-y divide-gray-100">
                      {categoryTools.map(tool => (
                        <div key={tool.name} className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50/50">
                          <Switch
                            isSelected={!!qqTools.enabledTools?.[tool.name]}
                            onChange={() => toggleTool(tool.name)}
                          >
                            <Switch.Content>
                              <Switch.Control>
                                <Switch.Thumb />
                              </Switch.Control>
                            </Switch.Content>
                          </Switch>
                          <Tooltip>
                            <Tooltip.Trigger>
                              <span className="text-sm text-gray-700 cursor-help hover:text-blue-600 transition-colors">
                                {tool.displayName}
                              </span>
                            </Tooltip.Trigger>
                            <Tooltip.Content>
                              <div className="max-w-xs space-y-1">
                                <p className="font-medium text-sm">{tool.displayName} ({tool.name})</p>
                                <p className="text-xs text-gray-300">{tool.description}</p>
                                {tool.parameters.length > 0 && (
                                  <>
                                    <p className="text-xs text-gray-400 mt-1">参数:</p>
                                    {tool.parameters.map(p => (
                                      <p key={p.name} className="text-xs text-gray-300">
                                        {p.name}: {p.type} {p.required ? '(必填)' : '(可选)'}
                                      </p>
                                    ))}
                                  </>
                                )}
                                {tool.example && (
                                  <p className="text-xs text-gray-400 mt-1">示例: {tool.example}</p>
                                )}
                              </div>
                            </Tooltip.Content>
                          </Tooltip>
                          <span className="text-xs text-gray-400 ml-auto">{tool.categoryLabel}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="text-sm text-gray-500 text-center py-8 bg-gray-50 rounded-lg border border-gray-200">
          当前跟随主 Agent 工具配置，开启独立配置后可单独启停工具
        </div>
      )}
    </div>
  )

  // ══════════════════════════════════════════════════════════════
  // 技能
  // ══════════════════════════════════════════════════════════════
  const renderSkillsSection = () => (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-gray-800 mb-1">技能配置</h3>
        <p className="text-xs text-gray-400 mb-3">
          选择 QQ 智能体单独加载的技能，不影响主 Agent。默认跟随主 Agent 配置，开启独立配置后可单独选择。
        </p>
      </div>

      {/* 独立开关 */}
      <div className="flex items-center gap-2">
        <Switch
          isSelected={qqSkills.independent}
          onChange={(val) => {
            if (val) {
              // 从主 Agent 复制当前技能配置
              const mainSkills = currentAgent?.skills
              setQqSkills({
                independent: true,
                enabledSkills: mainSkills?.enabledSkills ? [...mainSkills.enabledSkills] : [],
                disabledSkills: mainSkills?.disabledSkills ? [...mainSkills.disabledSkills] : [],
              })
            } else {
              resetToMainSkills()
            }
          }}
        >
          <Switch.Content>
            <Switch.Control>
              <Switch.Thumb />
            </Switch.Control>
          </Switch.Content>
        </Switch>
        <span className="text-sm text-gray-700 select-none">独立配置（不与主 Agent 同步）</span>
      </div>

      {qqSkills.independent ? (
        availableSkills.length === 0 ? (
          <div className="text-sm text-gray-400 text-center py-8 bg-gray-50 rounded-lg border border-gray-200">
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
                  const isEnabled = qqSkills.enabledSkills?.includes(skill.name) ?? false
                  return (
                    <tr key={skill.id} className={`border-b border-gray-100 hover:bg-gray-50 ${idx % 2 === 1 ? 'bg-gray-50/50' : ''}`}>
                      <td className="px-4 py-2.5">
                        <Switch
                          isSelected={isEnabled}
                          onChange={() => toggleSkill(skill.name)}
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
        )
      ) : (
        <div className="text-sm text-gray-500 text-center py-8 bg-gray-50 rounded-lg border border-gray-200">
          当前跟随主 Agent 技能配置，开启独立配置后可单独选择技能
        </div>
      )}
    </div>
  )

  // ══════════════════════════════════════════════════════════════
  // 偏好
  // ══════════════════════════════════════════════════════════════
  const renderPreferencesSection = () => (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-gray-800 mb-1">偏好设置</h3>
        <p className="text-xs text-gray-400 mb-3">
          扩展功能配置，暂无可用的偏好选项。
        </p>
      </div>
      <div className="text-sm text-gray-400 text-center py-12 bg-gray-50 rounded-lg border border-gray-200 border-dashed">
        <Construction size={32} className="mx-auto mb-2 text-gray-300" />
        <div>更多偏好选项开发中，敬请期待</div>
      </div>
    </div>
  )

  // ══════════════════════════════════════════════════════════════
  // 设定
  // ══════════════════════════════════════════════════════════════
  const renderPromptSection = () => {
    const compiledPrompt = currentAgent?.qqCompiledPrompt ?? ''
    const hasPrompt = compiledPrompt.length > 0

    return (
      <div className="space-y-6">
        <div>
          <h3 className="text-sm font-semibold text-gray-800 mb-1">系统提示词</h3>
          <p className="text-xs text-gray-400 mb-3">
            此处显示完整的系统提示词（不包含工具、技能等动态注入部分）。
            如需修改，请点击下方按钮进入编辑模式。
          </p>
        </div>

        {/* 提示词展示 */}
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
          {hasPrompt ? (
            <pre className="text-xs text-gray-700 whitespace-pre-wrap font-mono leading-relaxed max-h-96 overflow-y-auto">
              {compiledPrompt}
            </pre>
          ) : (
            <div className="text-sm text-gray-400 text-center py-4">
              保存配置后将自动生成 QQ 系统提示词
            </div>
          )}
        </div>

        {/* 编辑按钮 */}
        <div className="flex items-center justify-between">
          <p className="text-xs text-gray-400">
            保存后自动编译，运行时直接使用
          </p>
          <Button
            size="sm"
            variant="ghost"
            onPress={() => {
              // 始终以 default.json 内容为编辑起点，与后端 compileQQ 保持一致
              setPromptEditText(
                defaultPersona?.prompt ??
                formatPersonaToPrompt(currentAgent?.qqPersona ?? { identity: '', expertise: [], personality: [], workflowId: '' })
              )
              setPromptEditConfirmed(false)
              setShowPromptEditor(true)
            }}
          >
            <ExternalLink size={14} className="mr-1" />
            编辑系统提示词
          </Button>
        </div>
      </div>
    )
  }

  // ══════════════════════════════════════════════════════════════
  // 系统提示词编辑弹窗（二级菜单）
  // ══════════════════════════════════════════════════════════════
  const renderPromptEditor = () => {
    if (!showPromptEditor) return null

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowPromptEditor(false)}>
        <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto mx-4" onClick={(e) => e.stopPropagation()}>
          {/* 标题栏 */}
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <h3 className="text-base font-semibold text-gray-700">编辑系统提示词</h3>
            <button
              onClick={() => setShowPromptEditor(false)}
              className="text-gray-400 hover:text-gray-600 text-sm"
            >
              关闭
            </button>
          </div>

          <div className="px-6 py-4 space-y-4">
            {/* 风险提示 */}
            {!promptEditConfirmed && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <AlertTriangle size={20} className="text-amber-500 shrink-0 mt-0.5" />
                  <div>
                    <h4 className="text-sm font-semibold text-amber-800 mb-1">修改风险提示</h4>
                    <p className="text-xs text-amber-700 leading-relaxed">
                      系统提示词定义了 QQ 智能体的身份、行为规则和沟通风格。
                      不当修改可能导致智能体行为异常、回复不符合预期，甚至违反 QQ 群聊规范。
                      请确保你了解每项设置的含义。
                    </p>
                    <button
                      onClick={() => setPromptEditConfirmed(true)}
                      className="mt-3 px-4 py-1.5 text-sm bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors"
                    >
                      我已了解风险，继续编辑
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* 编辑区 */}
            {promptEditConfirmed && (
              <>
                <p className="text-xs text-gray-400">
                  编辑完成后保存，系统将自动编译更新。此修改仅影响 QQ 智能体，不影响主 Agent。
                </p>
                <TextArea
                  value={promptEditText}
                  onChange={(e) => setPromptEditText(e.target.value)}
                  placeholder="输入系统提示词..."
                  rows={20}
                  className="w-full resize-none font-mono text-sm"
                />
                <div className="flex justify-end gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onPress={() => setShowPromptEditor(false)}
                  >
                    取消
                  </Button>
                  <Button
                    size="sm"
                    variant="primary"
                    onPress={() => {
                      // 将编辑后的文本解析回 qqPersona
                      const parsed = parsePromptToPersona(promptEditText, qqPersona)
                      setQqPersona(parsed)
                      setShowPromptEditor(false)
                    }}
                  >
                    保存修改
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    )
  }

  // ══════════════════════════════════════════════════════════════
  // 渲染
  // ══════════════════════════════════════════════════════════════
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

      {/* 主体：侧边栏 + 内容 */}
      <div className="flex-1 min-h-0 flex bg-white">
        {renderSidebar()}

        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-6 pb-12">
          {error && (
            <div className="mb-6 p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-600">
              {error}
            </div>
          )}

          <div className="max-w-2xl mx-auto">
            <div className="text-xs text-gray-400 mb-4">
              分区 {SECTIONS.findIndex(s => s.id === activeSection) + 1} / {SECTIONS.length}
            </div>
            {renderSection()}
          </div>
        </div>
      </div>

      {/* 系统提示词编辑弹窗 */}
      {renderPromptEditor()}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// 子组件
// ════════════════════════════════════════════════════════════════

/** 定时配置的公共字段（时区 + 触发提示词） */
const TimingCommonFields: React.FC<{
  schedule: AgentSchedule
  onUpdate: (patch: Partial<AgentSchedule>) => void
  timezoneOptions: Array<{ value: string; label: string }>
}> = ({ schedule, onUpdate, timezoneOptions }) => (
  <>
    <div>
      <label className="text-xs text-gray-500 font-medium mb-1 block">时区</label>
      <Select
        selectedKey={schedule.timezone ?? 'Asia/Shanghai'}
        onSelectionChange={(key) => onUpdate({ timezone: key as string })}
      >
        <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
        <Select.Popover>
          <ListBox>
            {timezoneOptions.map(tz => (
              <ListBox.Item key={tz.value} id={tz.value} textValue={tz.label}>
                {tz.label}
                <ListBox.ItemIndicator />
              </ListBox.Item>
            ))}
          </ListBox>
        </Select.Popover>
      </Select>
    </div>
    <div>
      <label className="text-xs text-gray-500 font-medium mb-1 block">触发提示词（可选）</label>
      <TextArea
        value={schedule.prompt ?? ''}
        onChange={(e) => onUpdate({ prompt: e.target.value })}
        placeholder="定时触发时发送给 AI 的提示词，如：检查当前游戏状态并汇报"
        rows={2}
        className="w-full resize-none"
      />
    </div>
  </>
)

// ════════════════════════════════════════════════════════════════
// 工具函数
// ════════════════════════════════════════════════════════════════

/** 将 AgentPersona 格式化为可编辑的提示词文本 */
function formatPersonaToPrompt(persona: AgentPersona): string {
  const parts: string[] = []

  if (persona.identity) parts.push(`# 身份描述\n${persona.identity}`)
  if (persona.personality.length > 0) parts.push(`# 个性特征\n${persona.personality.join('\n')}`)
  if (persona.behaviorRules?.core?.length) parts.push(`# 行为规范\n${persona.behaviorRules.core.join('\n')}`)
  if (persona.communicationStyle?.length) parts.push(`# 沟通风格\n${persona.communicationStyle.join('\n')}`)
  if (persona.boundaries?.length) parts.push(`# 行为边界\n${persona.boundaries.join('\n')}`)

  return parts.join('\n\n---\n\n')
}

/** 将编辑后的提示词文本解析回 AgentPersona（保留未匹配字段） */
function parsePromptToPersona(text: string, current: AgentPersona): AgentPersona {
  const sections = text.split(/\n---\n/)
  const result: AgentPersona = { ...current }

  for (const section of sections) {
    const trimmed = section.trim()
    if (trimmed.startsWith('# 身份描述')) {
      result.identity = trimmed.replace(/^# 身份描述\n?/, '').trim()
    } else if (trimmed.startsWith('# 个性特征')) {
      const body = trimmed.replace(/^# 个性特征\n?/, '').trim()
      result.personality = body ? body.split('\n').filter(Boolean) : []
    } else if (trimmed.startsWith('# 行为规范')) {
      const body = trimmed.replace(/^# 行为规范\n?/, '').trim()
      const core = body ? body.split('\n').filter(Boolean) : []
      result.behaviorRules = {
        ...result.behaviorRules ?? { core: [], strategy: [], constraints: [] },
        core,
      }
    } else if (trimmed.startsWith('# 沟通风格')) {
      const body = trimmed.replace(/^# 沟通风格\n?/, '').trim()
      result.communicationStyle = body ? body.split('\n').filter(Boolean) : []
    } else if (trimmed.startsWith('# 行为边界')) {
      const body = trimmed.replace(/^# 行为边界\n?/, '').trim()
      result.boundaries = body ? body.split('\n').filter(Boolean) : []
    }
  }

  return result
}

export default QQConfigForm