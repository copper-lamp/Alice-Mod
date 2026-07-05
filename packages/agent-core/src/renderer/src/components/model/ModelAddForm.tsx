import React, { useState } from 'react'
import { Button, Select, ListBox } from '@heroui/react'
import { useModelStore } from '../../stores/modelStore'

interface Props {
  onSuccess: () => void
  onCancel: () => void
}

const PROVIDER_OPTIONS = [
  { id: 'openai', name: 'OpenAI' },
  { id: 'claude', name: 'Claude' },
  { id: 'gemini', name: 'Gemini' },
  { id: 'ollama', name: 'Ollama (本地)' },
  { id: 'deepseek', name: 'DeepSeek' },
  { id: 'qwen', name: '通义千问' },
  { id: 'moonshot', name: '月之暗面 (Kimi)' },
  { id: 'zhipu', name: '智谱 (GLM)' },
  { id: 'ernie', name: '百度文心 (ERNIE)' },
  { id: 'doubao', name: '字节豆包' },
  { id: 'yi', name: '零一万物 (Yi)' },
  { id: 'baichuan', name: '百川 (Baichuan)' },
  { id: 'minimax', name: 'MiniMax' },
  { id: 'spark', name: '讯飞星火' },
  { id: 'sensechat', name: '商汤 (SenseChat)' },
  { id: 'stepfun', name: '阶跃星辰 (StepFun)' },
]

const DEFAULT_BASE_URLS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  claude: 'https://api.anthropic.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
  ollama: 'http://127.0.0.1:11434',
  deepseek: 'https://api.deepseek.com/v1',
  qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  moonshot: 'https://api.moonshot.cn/v1',
  zhipu: 'https://open.bigmodel.cn/api/paas/v4',
  ernie: 'https://aip.baidubce.com/rpc/2.0/ai_custom',
  doubao: 'https://ark.cn-beijing.volces.com/api/v3',
  yi: 'https://api.lingyiwanwu.com/v1',
  baichuan: 'https://api.baichuan-ai.com/v1',
  minimax: 'https://api.minimax.chat/v1',
  spark: 'https://spark-api.xf-yun.com/v3.5/chat',
  sensechat: 'https://api.sensetime.com/v1',
  stepfun: 'https://api.stepfun.com/v1',
}

const DEFAULT_PROVIDER_NAMES: Record<string, string> = {
  openai: 'OpenAI', claude: 'Claude', gemini: 'Gemini', ollama: 'Ollama (本地)',
  deepseek: 'DeepSeek', qwen: '通义千问', moonshot: '月之暗面 (Kimi)',
  zhipu: '智谱 (GLM)', ernie: '百度文心 (ERNIE)', doubao: '字节豆包',
  yi: '零一万物 (Yi)', baichuan: '百川 (Baichuan)', minimax: 'MiniMax',
  spark: '讯飞星火', sensechat: '商汤 (SenseChat)', stepfun: '阶跃星辰 (StepFun)',
}

type FormErrors = Partial<Record<string, string>>

/** 添加模型表单 */
const ModelAddForm: React.FC<Props> = ({ onSuccess, onCancel }) => {
  const { addModel } = useModelStore()
  const [providerId, setProviderId] = useState('openai')
  const [modelName, setModelName] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState(DEFAULT_BASE_URLS.openai)
  const [errors, setErrors] = useState<FormErrors>({})
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')

  const handleProviderChange = (value: string) => {
    setProviderId(value)
    setBaseUrl(DEFAULT_BASE_URLS[value] || '')
    setErrors({})
  }

  const validate = (): boolean => {
    const errs: FormErrors = {}
    if (!modelName.trim()) errs.modelName = '请输入模型名称'
    if (!apiKey.trim()) errs.apiKey = '请输入 API Key'
    if (!baseUrl.trim()) errs.baseUrl = '请输入 Base URL'
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  const handleSubmit = async () => {
    if (!validate()) return
    setSubmitting(true)
    setSubmitError('')
    try {
      const autoCtx = await window.electronAPI.invoke('model:auto-context', {
        modelName: modelName.trim(),
      }) as { contextWindow: number; supportsFunctionCalling: boolean }

      const id = `${providerId}:${modelName.trim()}`

      const success = await addModel({
        id,
        providerId,
        providerName: DEFAULT_PROVIDER_NAMES[providerId] || providerId,
        modelName: modelName.trim(),
        apiKey: apiKey.trim(),
        baseUrl: baseUrl.trim(),
        enabled: true,
        contextWindow: autoCtx?.contextWindow || 4096,
        supportsFunctionCalling: autoCtx?.supportsFunctionCalling ?? true,
        createdAt: Date.now(),
      })
      if (success) {
        setModelName('')
        setApiKey('')
        setBaseUrl(DEFAULT_BASE_URLS.openai)
        setErrors({})
        onSuccess()
      } else {
        setSubmitError('模型添加失败，请重试')
      }
    } catch (e) {
      console.error('保存模型失败', e)
      setSubmitError(e instanceof Error ? e.message : '保存模型时发生错误')
    } finally {
      setSubmitting(false)
    }
  }

  const inputClass = (hasError?: string) =>
    `w-full px-3 py-2 text-sm border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 ${hasError ? 'border-red-300' : 'border-gray-200'}`
  const labelClass = 'block text-xs text-gray-500 font-medium mb-1.5'

  return (
    <div className="space-y-4">
      <div>
        <label className={labelClass}>Provider</label>
        <Select
          selectedKey={providerId}
          onSelectionChange={(key) => {
            if (key) {
              handleProviderChange(key.toString())
            }
          }}
          className="w-full"
        >
          <Select.Trigger className="w-full">
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              {PROVIDER_OPTIONS.map(opt => (
                <ListBox.Item key={opt.id} id={opt.id} textValue={opt.name}>
                  {opt.name}
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
      </div>

      <div>
        <label className={labelClass}>模型名称</label>
        <input value={modelName} onChange={(e) => { setModelName(e.target.value); setErrors({}) }}
          placeholder="gpt-4o" className={inputClass(errors.modelName)} />
        {errors.modelName && <span className="text-xs text-red-500 mt-0.5">{errors.modelName}</span>}
      </div>

      <div>
        <label className={labelClass}>API Key</label>
        <input type="password" value={apiKey} onChange={(e) => { setApiKey(e.target.value); setErrors({}) }}
          placeholder="sk-..." className={inputClass(errors.apiKey)} />
        {errors.apiKey && <span className="text-xs text-red-500 mt-0.5">{errors.apiKey}</span>}
      </div>

      <div>
        <label className={labelClass}>Base URL</label>
        <input value={baseUrl} onChange={(e) => { setBaseUrl(e.target.value); setErrors({}) }}
          placeholder="https://api.openai.com/v1" className={inputClass(errors.baseUrl)} />
        {errors.baseUrl && <span className="text-xs text-red-500 mt-0.5">{errors.baseUrl}</span>}
      </div>

      <div className="flex items-center gap-2 py-2">
        <span className="text-xs text-gray-500 font-medium">上下文窗口</span>
        <span className="text-xs text-blue-500 bg-blue-50 px-2 py-0.5 rounded">自动设置</span>
      </div>

      {submitError && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
          <span className="text-xs text-red-600">{submitError}</span>
        </div>
      )}

      <div className="flex gap-2 pt-2">
        <Button onPress={handleSubmit} isDisabled={submitting}>
          {submitting ? '保存中...' : '保存'}
        </Button>
        <Button variant="secondary" onPress={onCancel}>取消</Button>
      </div>
    </div>
  )
}

export default ModelAddForm