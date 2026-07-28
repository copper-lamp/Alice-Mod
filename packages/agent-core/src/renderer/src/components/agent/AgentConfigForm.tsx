import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Input,
  Label,
  ListBox,
  Modal,
  Select,
  TextArea,
  TextField,
  toast,
  useOverlayState,
} from '@heroui/react'
import { AlertTriangle, RefreshCw, Trash2 } from 'lucide-react'
import { useAgentStore } from '../../stores/agentStore'
import { useModelStore } from '../../stores/modelStore'
import { useUIStore } from '../../stores/uiStore'
import { memoryApi, toolApi } from '../../lib/ipc'
import type {
  AgentConfig,
  AgentPersona,
  AgentSkillConfig,
  ModelSelection,
  QQAgentSkillConfig,
  ToolInfo,
} from '../../lib/types'
import Toggle from '../ui/Toggle'
import BasicInfoSection from './sections/BasicInfoSection'
import QQBindSection from './sections/QQBindSection'
import ScheduleSection from './sections/ScheduleSection'

interface AgentConfigFormProps {
  agentId?: string
  onDirtyChange?: (dirty: boolean) => void
  onDeleted?: () => void
}

type SkillItem = { id: string; name: string; description: string }

const emptyPersona = (): AgentPersona => ({ identity: '', expertise: [], personality: [], workflowId: '' })
const emptyModel = (sameAsMain = false): ModelSelection => ({ providerId: '', modelId: '', modelName: '', ...(sameAsMain ? { sameAsMain: true } : {}) })

const createDefaultConfig = (): AgentConfig => ({
  name: '',
  persona: emptyPersona(),
  tools: { enabledTools: {} },
  skills: {},
  qqBinding: { enabled: false, accountId: '', groupIds: [] },
  qqPersona: emptyPersona(),
  qqTools: { independent: false, enabledTools: {} },
  qqSkills: { independent: false },
  llmConfig: {
    mainModel: emptyModel(),
    qqBotModel: emptyModel(true),
    compressionModel: emptyModel(true),
  },
})

function cloneValue<T>(value: T): T {
  return structuredClone(value)
}

function normalizeConfig(config?: AgentConfig | null): AgentConfig {
  const defaults = createDefaultConfig()
  if (!config) return defaults
  return {
    ...cloneValue(config),
    name: config.name ?? '',
    persona: { ...emptyPersona(), ...cloneValue(config.persona) },
    tools: { enabledTools: { ...(config.tools?.enabledTools ?? {}) } },
    skills: cloneValue(config.skills ?? {}),
    qqBinding: { ...cloneValue(config.qqBinding), enabled: config.qqBinding?.enabled ?? false, groupIds: [...(config.qqBinding?.groupIds ?? [])] },
    qqPersona: config.qqPersona ? { ...emptyPersona(), ...cloneValue(config.qqPersona) } : undefined,
    qqTools: { independent: false, enabledTools: {}, ...cloneValue(config.qqTools ?? {}) },
    qqSkills: { independent: false, ...cloneValue(config.qqSkills ?? {}) },
    llmConfig: {
      mainModel: { ...emptyModel(), ...cloneValue(config.llmConfig?.mainModel) },
      qqBotModel: { ...emptyModel(true), ...cloneValue(config.llmConfig?.qqBotModel) },
      compressionModel: { ...emptyModel(true), ...cloneValue(config.llmConfig?.compressionModel) },
    },
    schedule: config.schedule ? cloneValue(config.schedule) : undefined,
  }
}

function formatPersona(persona: AgentPersona): string {
  const parts: string[] = []
  if (persona.identity) parts.push(`# 身份描述\n${persona.identity}`)
  if (persona.personality.length) parts.push(`# 个性特征\n${persona.personality.join('\n')}`)
  if (persona.behaviorRules?.core?.length) parts.push(`# 行为规范\n${persona.behaviorRules.core.join('\n')}`)
  if (persona.communicationStyle?.length) parts.push(`# 沟通风格\n${persona.communicationStyle.join('\n')}`)
  if (persona.boundaries?.length) parts.push(`# 行为边界\n${persona.boundaries.join('\n')}`)
  return parts.join('\n\n---\n\n')
}

function parsePersona(text: string, current: AgentPersona): AgentPersona {
  const result = cloneValue({ ...createDefaultConfig(), persona: current }).persona
  for (const section of text.split(/\n---\n/)) {
    const trimmed = section.trim()
    const lines = trimmed.split('\n')
    const body = lines.slice(1).filter(Boolean)
    if (trimmed.startsWith('# 身份描述')) result.identity = body.join('\n')
    else if (trimmed.startsWith('# 个性特征')) result.personality = body
    else if (trimmed.startsWith('# 行为规范')) {
      result.behaviorRules = { ...(result.behaviorRules ?? { core: [], strategy: [], constraints: [] }), core: body }
    } else if (trimmed.startsWith('# 沟通风格')) result.communicationStyle = body
    else if (trimmed.startsWith('# 行为边界')) result.boundaries = body
  }
  return result
}

/* ---------- 局部组件 ---------- */

const SectionCard: React.FC<{ title: string; description: string; children: React.ReactNode; danger?: boolean }> = ({ title, description, children, danger }) => (
  <section className={`rounded-xl bg-surface-secondary/50 p-5 ${danger ? 'border border-danger/20' : ''}`}>
    <div className="mb-5">
      <h3 className={`text-base font-semibold ${danger ? 'text-danger' : 'text-foreground'}`}>{title}</h3>
      <p className="mt-1 text-sm text-muted">{description}</p>
    </div>
    {children}
  </section>
)

const ModelSelect: React.FC<{
  label: string
  value: ModelSelection
  models: Array<{ id: string; providerId: string; providerName: string; modelName: string }>
  onChange: (value: ModelSelection) => void
}> = ({ label, value, models, onChange }) => (
  <div>
    <label className="mb-1.5 block text-sm font-medium text-foreground">{label}</label>
    <Select selectedKey={value.modelId || undefined} placeholder="请选择模型" onSelectionChange={(key) => {
      const model = models.find(item => item.id === key)
      if (model) onChange({ providerId: model.providerId, modelId: model.id, modelName: model.modelName, sameAsMain: false })
    }}>
      <Select.Trigger className="w-full"><Select.Value /><Select.Indicator /></Select.Trigger>
      <Select.Popover><ListBox>{models.map(model => (
        <ListBox.Item key={model.id} id={model.id} textValue={`${model.providerName} - ${model.modelName}`}>
          {model.providerName} - {model.modelName}<ListBox.ItemIndicator />
        </ListBox.Item>
      ))}</ListBox></Select.Popover>
    </Select>
  </div>
)

const FollowSwitch: React.FC<{ label: string; selected: boolean; onChange: (v: boolean) => void }> = ({ label, selected, onChange }) => (
  <div className="flex items-center gap-2">
    <Toggle selected={selected} onChange={onChange} label={label} />
    <span className="text-xs text-muted">{label}</span>
  </div>
)

const SkillList: React.FC<{
  skills: SkillItem[]
  config: AgentSkillConfig
  onChange: (value: AgentSkillConfig) => void
  labelPrefix: string
}> = ({ skills, config, onChange, labelPrefix }) => (
  skills.length === 0
    ? <p className="rounded-lg bg-surface p-4 text-center text-sm text-muted">暂无可用技能</p>
    : <div className="space-y-2">
        {skills.map(skill => {
          const whitelist = config.enabledSkills ?? []
          const enabled = whitelist.length > 0 ? whitelist.includes(skill.name) : !(config.disabledSkills ?? []).includes(skill.name)
          return (
            <div key={skill.id} className="flex items-center gap-3 rounded-lg bg-surface px-3 py-2.5">
              <Toggle selected={enabled} onChange={() => {
                if (whitelist.length > 0) {
                  onChange({ enabledSkills: enabled ? whitelist.filter(name => name !== skill.name) : [...whitelist, skill.name] })
                } else {
                  const disabled = config.disabledSkills ?? []
                  onChange({ disabledSkills: enabled ? [...disabled, skill.name] : disabled.filter(name => name !== skill.name) })
                }
              }} label={`${labelPrefix}${skill.name}`} />
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">{skill.name}</p>
                <p className="truncate text-xs text-muted">{skill.description || '无描述'}</p>
              </div>
            </div>
          )
        })}
      </div>
)

const ToolList: React.FC<{
  tools: ToolInfo[]
  enabledTools: Record<string, boolean>
  onChange: (value: Record<string, boolean>) => void
}> = ({ tools, enabledTools, onChange }) => (
  tools.length === 0
    ? <p className="rounded-lg bg-surface p-4 text-center text-sm text-muted">暂无已注册工具，请先连接 Adapter Core</p>
    : <div className="grid gap-2 sm:grid-cols-2">
        {tools.map(tool => (
          <div key={tool.name} className="flex items-center gap-3 rounded-lg bg-surface px-3 py-2.5">
            <Toggle selected={Boolean(enabledTools[tool.name])} onChange={() => onChange({ ...enabledTools, [tool.name]: !enabledTools[tool.name] })} label={`工具 ${tool.displayName}`} />
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">{tool.displayName}</p>
              <p className="truncate text-xs text-muted">{tool.description}</p>
            </div>
          </div>
        ))}
      </div>
)

/* ---------- 主表单 ---------- */

const AgentConfigForm: React.FC<AgentConfigFormProps> = ({ agentId, onDirtyChange, onDeleted }) => {
  const { updateAgent, deleteAgent, fetchAgent, refreshAgents, currentAgent } = useAgentStore()
  const { models, fetchModels } = useModelStore()
  const { setLayoutMode, navigateToAgent, setActiveNav } = useUIStore()

  const [initialForm, setInitialForm] = useState<AgentConfig>(() => createDefaultConfig())
  const [form, setForm] = useState<AgentConfig>(() => createDefaultConfig())
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')
  const [skills, setSkills] = useState<SkillItem[]>([])
  const [tools, setTools] = useState<ToolInfo[]>([])
  const [toolsLoading, setToolsLoading] = useState(false)
  const [promptText, setPromptText] = useState('')
  const [promptRiskAccepted, setPromptRiskAccepted] = useState(false)
  const promptState = useOverlayState()
  const deleteState = useOverlayState()

  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(initialForm), [form, initialForm])
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange])
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange])

  /* ---------- 数据加载 ---------- */

  const loadTools = useCallback(async () => {
    setToolsLoading(true)
    try { setTools(await toolApi.listAll()) } catch { toast.danger('工具列表加载失败') } finally { setToolsLoading(false) }
  }, [])

  const loadSkills = useCallback(async () => {
    try {
      const result = await memoryApi.list({ type: 'skill', limit: 100 })
      setSkills((result.memories ?? []).map((memory: any) => {
        const content = (memory.content as Record<string, unknown>) ?? {}
        return { id: memory.id ?? '', name: String(content.name ?? ''), description: String(content.description ?? '') }
      }))
    } catch { toast.danger('技能列表加载失败') }
  }, [])

  useEffect(() => { fetchModels(); loadTools(); loadSkills() }, [fetchModels, loadTools, loadSkills])

  useEffect(() => { if (agentId) fetchAgent(agentId) }, [agentId, fetchAgent])

  useEffect(() => {
    if (agentId && currentAgent?.id === agentId) {
      const normalized = normalizeConfig(currentAgent)
      setInitialForm(normalized)
      setForm(cloneValue(normalized))
      setError('')
    } else if (!agentId) {
      const empty = createDefaultConfig()
      setInitialForm(empty)
      setForm(cloneValue(empty))
    }
  }, [agentId, currentAgent])

  /* ---------- 更新操作 ---------- */

  const updateField = <K extends keyof AgentConfig>(key: K, value: AgentConfig[K]) => setForm(prev => ({ ...prev, [key]: value }))
  const setModel = (key: 'mainModel' | 'qqBotModel' | 'compressionModel', value: ModelSelection) => updateField('llmConfig', { ...form.llmConfig, [key]: value })

  const handleSave = async () => {
    if (!agentId) return
    setSaving(true); setError('')
    try {
      await updateAgent(agentId, cloneValue(form))
      await Promise.all([fetchAgent(agentId), refreshAgents()])
      const saved = normalizeConfig(useAgentStore.getState().currentAgent ?? form)
      setInitialForm(saved); setForm(cloneValue(saved))
      toast.success('设置已保存')
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : '保存失败'
      setError(message); toast.danger(message)
    } finally { setSaving(false) }
  }

  const handleDelete = async () => {
    if (!agentId) return
    setDeleting(true); setError('')
    try {
      await deleteAgent(agentId)
      deleteState.close(); onDirtyChange?.(false); onDeleted?.(); toast.success('智能体已删除')
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : '删除失败'
      setError(message); toast.danger(message)
    } finally { setDeleting(false) }
  }

  /* ---------- 派生值 ---------- */

  const qqTools = form.qqTools ?? { independent: false, enabledTools: {} }
  const qqSkills = form.qqSkills ?? { independent: false }
  const canSave = Boolean(form.name.trim() && form.llmConfig.mainModel.modelId && form.schedule?.mode !== 'random')

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      {/* 顶部操作栏 */}
      <div className="sticky top-0 z-10 flex shrink-0 items-center justify-between border-b border-separator bg-background/95 px-6 py-3 backdrop-blur">
        <div>
          <h2 className="text-lg font-semibold text-foreground">智能体设置</h2>
          <p className="text-xs text-muted">{dirty ? '有未保存的修改' : '所有修改已保存'}</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" isDisabled={!dirty || saving} onPress={() => { setForm(cloneValue(initialForm)); setError('') }}>
            放弃修改
          </Button>
          <Button size="sm" variant="primary" isPending={saving} isDisabled={!dirty || saving || !canSave} onPress={handleSave}>
            保存更改
          </Button>
        </div>
      </div>

      {/* 表单内容 */}
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto max-w-4xl space-y-6">
          {error ? (
            <Alert status="danger">
              <Alert.Content>
                <Alert.Title>设置操作失败</Alert.Title>
                <Alert.Description>{error}</Alert.Description>
              </Alert.Content>
            </Alert>
          ) : null}

          {/* ── 1. 基本与模型 ── */}
          <SectionCard title="基本与模型" description="设置智能体名称、头像和运行所使用的模型。">
            <div className="space-y-5">
              <BasicInfoSection
                name={form.name}
                skinData={form.skinData}
                onChange={(name, skinData) => setForm(v => ({ ...v, name, skinData }))}
              />
              <div className="grid gap-4 md:grid-cols-2">
                <ModelSelect label="主模型" value={form.llmConfig.mainModel} models={models} onChange={v => setModel('mainModel', v)} />
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-sm font-medium text-foreground">压缩模型</span>
                    <FollowSwitch label="跟随主模型" selected={form.llmConfig.compressionModel.sameAsMain ?? true} onChange={same => setModel('compressionModel', same ? emptyModel(true) : { ...form.llmConfig.compressionModel, sameAsMain: false })} />
                  </div>
                  {form.llmConfig.compressionModel.sameAsMain
                    ? <p className="rounded-lg bg-surface p-3 text-sm text-muted">当前使用主模型</p>
                    : <ModelSelect label="独立压缩模型" value={form.llmConfig.compressionModel} models={models} onChange={v => setModel('compressionModel', v)} />
                  }
                </div>
              </div>
              <Button size="sm" variant="ghost" onPress={() => { setLayoutMode('nav-view'); setActiveNav('model') }}>
                添加模型
              </Button>
            </div>
          </SectionCard>

          {/* ── 2. 人设与系统提示词 ── */}
          <SectionCard title="人设与系统提示词" description="配置智能体的身份描述、个性特征和系统提示词。">
            <div className="space-y-5">
              <TextField value={form.persona.identity} onChange={identity => updateField('persona', { ...form.persona, identity })}>
                <Label>身份描述</Label>
                <TextArea rows={3} placeholder="描述智能体的身份和角色定位…" />
              </TextField>
              <TextField value={form.persona.personality.join('\n')} onChange={v => updateField('persona', { ...form.persona, personality: v.split('\n').filter(Boolean) })}>
                <Label>个性特征（每行一个）</Label>
                <TextArea rows={3} placeholder="输入个性特征，每行一个…" />
              </TextField>
              <div>
                <h4 className="mb-2 text-sm font-medium text-foreground">系统提示词预览（只读）</h4>
                <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-lg bg-surface p-4 text-xs text-foreground">
                  {currentAgent?.compiledPrompt || '保存配置后将自动生成系统提示词'}
                </pre>
              </div>
            </div>
          </SectionCard>

          {/* ── 3. 工具与技能 ── */}
          <SectionCard title="工具与技能" description="管理主智能体的工具和技能。">
            <div className="space-y-5">
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <h4 className="text-sm font-medium text-foreground">主工具</h4>
                  <span className="text-xs text-muted">已启用 {Object.values(form.tools.enabledTools).filter(Boolean).length} 个</span>
                </div>
                <ToolList
                  tools={tools}
                  enabledTools={form.tools.enabledTools}
                  onChange={enabledTools => updateField('tools', { enabledTools })}
                />
              </div>
              <div>
                <h4 className="mb-2 text-sm font-medium text-foreground">主技能</h4>
                <SkillList skills={skills} config={form.skills ?? {}} onChange={v => updateField('skills', v)} labelPrefix="主技能 " />
              </div>
            </div>
          </SectionCard>

          {/* ── 4. QQ 连接 ── */}
          <SectionCard title="QQ 连接" description="配置 QQ 机器人绑定、模型、人设、工具和技能。">
            <div className="space-y-6">
              <QQBindSection binding={form.qqBinding} onChange={v => updateField('qqBinding', v)} />

              <div className="grid gap-4 md:grid-cols-2">
                {/* QQ 模型 */}
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-sm font-medium text-foreground">QQ 模型</span>
                    <FollowSwitch label="跟随主模型" selected={form.llmConfig.qqBotModel.sameAsMain ?? true} onChange={same => setModel('qqBotModel', same ? emptyModel(true) : { ...form.llmConfig.qqBotModel, sameAsMain: false })} />
                  </div>
                  {form.llmConfig.qqBotModel.sameAsMain
                    ? <p className="rounded-lg bg-surface p-3 text-sm text-muted">当前使用主模型</p>
                    : <ModelSelect label="QQ 独立模型" value={form.llmConfig.qqBotModel} models={models} onChange={v => setModel('qqBotModel', v)} />
                  }
                </div>

                {/* QQ 人设 */}
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-sm font-medium text-foreground">QQ 人设</span>
                    <FollowSwitch label="独立配置" selected={Boolean(form.qqPersona)} onChange={independent => updateField('qqPersona', independent ? cloneValue(form.persona) : undefined)} />
                  </div>
                  <Button size="sm" variant="secondary" onPress={() => { setPromptText(formatPersona(form.qqPersona ?? form.persona)); setPromptRiskAccepted(false); promptState.open() }}>
                    编辑 QQ 系统提示词
                  </Button>
                </div>
              </div>

              {/* QQ 工具 */}
              <div>
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-medium text-foreground">QQ 工具</h4>
                    <p className="text-xs text-muted">默认跟随主智能体，可切换为独立配置。</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button isIconOnly size="sm" variant="ghost" aria-label="刷新工具列表" isPending={toolsLoading} onPress={loadTools}>
                      <RefreshCw size={14} />
                    </Button>
                    <FollowSwitch label="独立配置" selected={qqTools.independent} onChange={independent => updateField('qqTools', independent ? { independent: true, enabledTools: { ...form.tools.enabledTools } } : { independent: false, enabledTools: {} })} />
                  </div>
                </div>
                {qqTools.independent
                  ? <ToolList tools={tools} enabledTools={qqTools.enabledTools ?? {}} onChange={enabledTools => updateField('qqTools', { ...qqTools, enabledTools })} />
                  : <p className="rounded-lg bg-surface p-3 text-sm text-muted">当前跟随主智能体工具</p>
                }
              </div>

              {/* QQ 技能 */}
              <div>
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-medium text-foreground">QQ 技能</h4>
                    <p className="text-xs text-muted">默认跟随主智能体，可切换为独立配置。</p>
                  </div>
                  <FollowSwitch label="独立配置" selected={qqSkills.independent} onChange={independent => {
                    updateField('qqSkills', independent
                      ? { independent: true, enabledSkills: [...(form.skills?.enabledSkills ?? [])], disabledSkills: [...(form.skills?.disabledSkills ?? [])] }
                      : { independent: false })
                  }} />
                </div>
                {qqSkills.independent
                  ? <SkillList skills={skills} config={qqSkills} onChange={v => updateField('qqSkills', { independent: true, ...v } as QQAgentSkillConfig)} labelPrefix="QQ 技能 " />
                  : <p className="rounded-lg bg-surface p-3 text-sm text-muted">当前跟随主智能体技能</p>
                }
              </div>
            </div>
          </SectionCard>

          {/* ── 5. 定时触发 ── */}
          <SectionCard title="定时触发" description="配置智能体的定时任务调度。">
            <ScheduleSection schedule={form.schedule} onChange={v => updateField('schedule', v)} />
          </SectionCard>

          {/* ── 6. 危险操作 ── */}
          {agentId ? (
            <SectionCard title="危险操作" description="删除后无法恢复智能体及其配置。" danger>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-foreground">删除智能体</p>
                  <p className="text-xs text-muted">此操作不可撤销。</p>
                </div>
                <Button size="sm" variant="danger" onPress={() => deleteState.open()}>
                  <Trash2 size={14} />删除智能体
                </Button>
              </div>
            </SectionCard>
          ) : null}
        </div>
      </div>

      {/* ── Modal：编辑 QQ 系统提示词 ── */}
      <Modal state={promptState}>
        <div />
        <Modal.Backdrop>
          <Modal.Container size="lg">
            <Modal.Dialog>
              {() => (
                <>
                  <Modal.Header>
                    <Modal.Icon className="bg-warning-soft text-warning-soft-foreground">
                      <AlertTriangle size={16} />
                    </Modal.Icon>
                    <Modal.Heading>编辑 QQ 系统提示词</Modal.Heading>
                  </Modal.Header>
                  <Modal.Body>
                    {!promptRiskAccepted ? (
                      <div className="rounded-lg bg-warning-soft p-4 text-sm text-warning-soft-foreground">
                        <p className="font-medium">修改风险提示</p>
                        <p className="mt-1 text-xs">
                          不当修改可能导致 QQ 智能体行为异常。应用后只写入当前表单，仍需点击"保存更改"才会持久化。
                        </p>
                        <Button className="mt-4" size="sm" variant="secondary" onPress={() => setPromptRiskAccepted(true)}>
                          我已了解风险，继续编辑
                        </Button>
                      </div>
                    ) : (
                      <TextField value={promptText} onChange={setPromptText}>
                        <Label>系统提示词</Label>
                        <TextArea rows={18} className="font-mono" />
                      </TextField>
                    )}
                  </Modal.Body>
                  <Modal.Footer>
                    <Button size="sm" variant="secondary" onPress={() => promptState.close()}>取消</Button>
                    <Button size="sm" variant="primary" isDisabled={!promptRiskAccepted} onPress={() => {
                      updateField('qqPersona', parsePersona(promptText, form.qqPersona ?? form.persona))
                      promptState.close()
                    }}>
                      应用到表单
                    </Button>
                  </Modal.Footer>
                </>
              )}
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>

      {/* ── Modal：确认删除 ── */}
      <Modal state={deleteState}>
        <div />
        <Modal.Backdrop>
          <Modal.Container size="xs">
            <Modal.Dialog>
              {() => (
                <>
                  <Modal.Header>
                    <Modal.Icon className="bg-danger-soft text-danger-soft-foreground">
                      <AlertTriangle size={16} />
                    </Modal.Icon>
                    <Modal.Heading>确认删除智能体</Modal.Heading>
                  </Modal.Header>
                  <Modal.Body>
                    <p className="text-sm text-muted">
                      确定删除 <strong className="text-foreground">{form.name}</strong>？此操作不可恢复。
                    </p>
                    {error
                      ? <p role="alert" className="mt-3 rounded-lg bg-danger-soft p-3 text-sm text-danger-soft-foreground">{error}</p>
                      : null}
                  </Modal.Body>
                  <Modal.Footer>
                    <Button size="sm" variant="secondary" isDisabled={deleting} onPress={() => deleteState.close()}>取消</Button>
                    <Button size="sm" variant="danger" isPending={deleting} isDisabled={deleting} onPress={handleDelete}>确认删除</Button>
                  </Modal.Footer>
                </>
              )}
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </div>
  )
}

export default AgentConfigForm