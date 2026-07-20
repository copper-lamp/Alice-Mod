import React, { useState } from 'react'
import { Button, Switch } from '@heroui/react'
import type { ModelConfigItem } from '../../lib/types'
import { useModelStore } from '../../stores/modelStore'

interface Props {
  model: ModelConfigItem
}

/** 模型操作按钮（编辑 / 删除 / 启用状态 / 测试连接） */
const ModelCard: React.FC<Props> = ({ model }) => {
  const { updateModel, removeModel } = useModelStore()
  const [editing, setEditing] = useState(false)

  const [formApiKey, setFormApiKey] = useState(model.apiKey)
  const [formBaseUrl, setFormBaseUrl] = useState(model.baseUrl)
  const [formContextWindow, setFormContextWindow] = useState(model.contextWindow)
  const [formFC, setFormFC] = useState(model.supportsFunctionCalling)

  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; message: string; latencyMs: number } | null>(null)

  const handleSave = async () => {
    await updateModel(model.id, {
      apiKey: formApiKey,
      baseUrl: formBaseUrl,
      contextWindow: formContextWindow,
      supportsFunctionCalling: formFC,
    })
    setEditing(false)
  }

  const handleCancel = () => {
    setFormApiKey(model.apiKey)
    setFormBaseUrl(model.baseUrl)
    setFormContextWindow(model.contextWindow)
    setFormFC(model.supportsFunctionCalling)
    setEditing(false)
  }

  const handleToggleEnabled = async () => {
    await updateModel(model.id, { enabled: !model.enabled })
  }

  const handleDelete = async () => {
    await removeModel(model.id)
  }

  const handleTestConnection = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const result = await window.electronAPI.invoke('model:test-connection', {
        baseUrl: formBaseUrl,
        apiKey: formApiKey,
        modelName: model.modelName,
        providerId: model.providerId,
      }) as { success: boolean; message: string; latencyMs: number }
      setTestResult(result)
    } catch (e) {
      setTestResult({ success: false, message: e instanceof Error ? e.message : '测试失败', latencyMs: 0 })
    } finally {
      setTesting(false)
    }
  }

  // 编辑模式：内联表单
  if (editing) {
    return (
      <div className="flex items-center gap-2 flex-wrap">
        <input
          type="password"
          value={formApiKey}
          onChange={(e) => setFormApiKey(e.target.value)}
          placeholder="API Key"
          className="w-28 px-2 py-1 text-xs border border-gray-200 rounded bg-white focus:outline-none focus:ring-1 focus:ring-blue-500/20 focus:border-blue-500"
        />
        <input
          value={formBaseUrl}
          onChange={(e) => setFormBaseUrl(e.target.value)}
          placeholder="Base URL"
          className="w-36 px-2 py-1 text-xs border border-gray-200 rounded bg-white focus:outline-none focus:ring-1 focus:ring-blue-500/20 focus:border-blue-500"
        />
        <input
          type="number"
          value={formContextWindow}
          onChange={(e) => setFormContextWindow(parseInt(e.target.value) || 4096)}
          className="w-24 px-2 py-1 text-xs border border-gray-200 rounded bg-white focus:outline-none focus:ring-1 focus:ring-blue-500/20 focus:border-blue-500"
          title="Context Window"
          placeholder="Context Window"
        />
        <select
          value={formFC ? 'true' : 'false'}
          onChange={(e) => setFormFC(e.target.value === 'true')}
          className="w-20 px-2 py-1 text-xs border border-gray-200 rounded bg-white focus:outline-none focus:ring-1 focus:ring-blue-500/20 focus:border-blue-500"
          title="Function Calling"
        >
          <option value="true">FC: 是</option>
          <option value="false">FC: 否</option>
        </select>
        <Button size="sm" onPress={handleSave}>保存</Button>
        <Button size="sm" variant="secondary" onPress={handleCancel}>取消</Button>
      </div>
    )
  }

  // 展示模式：操作按钮 + 模型信息
  return (
    <div className="flex items-center gap-1.5">
      {/* 上下文窗口标签 */}
      <span className="text-[10px] text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded border border-gray-100 whitespace-nowrap" title="上下文窗口">
        {model.contextWindow.toLocaleString()}
      </span>
      {/* Function Calling 标签 */}
      <span className={`text-[10px] px-1.5 py-0.5 rounded border whitespace-nowrap ${model.supportsFunctionCalling ? 'text-green-600 bg-green-50 border-green-100' : 'text-gray-400 bg-gray-50 border-gray-100'}`} title="Function Calling">
        {model.supportsFunctionCalling ? 'FC' : 'no FC'}
      </span>

      <Button size="sm" variant="secondary" onPress={() => setEditing(true)}>
        编辑
      </Button>
      <Button size="sm" variant="danger" onPress={handleDelete}>
        删除
      </Button>
      <Switch isSelected={model.enabled} onChange={handleToggleEnabled}>
        <Switch.Content>
          <Switch.Control>
            <Switch.Thumb />
          </Switch.Control>
        </Switch.Content>
      </Switch>
      <div className="flex items-center gap-1">
        <Button size="sm" variant="secondary" isDisabled={testing} onPress={handleTestConnection}>
          {testing ? '测试中...' : '测试'}
        </Button>
        {testResult && (
          <span className={`text-xs ${testResult.success ? 'text-green-600' : 'text-red-500'}`}>
            {testResult.success
              ? `${testResult.latencyMs}ms`
              : testResult.message}
          </span>
        )}
      </div>
    </div>
  )
}

export default ModelCard