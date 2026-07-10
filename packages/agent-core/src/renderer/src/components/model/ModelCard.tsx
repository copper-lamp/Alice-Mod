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

  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; message: string; latencyMs: number } | null>(null)

  const handleSave = async () => {
    await updateModel(model.id, {
      apiKey: formApiKey,
      baseUrl: formBaseUrl,
    })
    setEditing(false)
  }

  const handleCancel = () => {
    setFormApiKey(model.apiKey)
    setFormBaseUrl(model.baseUrl)
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
      <div className="flex items-center gap-2">
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
        <Button size="sm" onPress={handleSave}>保存</Button>
        <Button size="sm" variant="secondary" onPress={handleCancel}>取消</Button>
      </div>
    )
  }

  // 展示模式：操作按钮
  return (
    <div className="flex items-center gap-1.5">
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