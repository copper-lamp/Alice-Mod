import React, { useState } from 'react'
import { Card, TextField, Input, Label, Button, Checkbox } from '@heroui/react'
import type { ModelConfigItem } from '../../lib/types'
import { useModelStore } from '../../stores/modelStore'

interface Props {
  model: ModelConfigItem
}

/** 单个模型卡片，支持查看和编辑模式 */
const ModelCard: React.FC<Props> = ({ model }) => {
  const { updateModel, removeModel } = useModelStore()
  const [editing, setEditing] = useState(false)

  const [formApiKey, setFormApiKey] = useState(model.apiKey)
  const [formBaseUrl, setFormBaseUrl] = useState(model.baseUrl)
  const [formEnabled, setFormEnabled] = useState(model.enabled)

  const handleSave = async () => {
    await updateModel(model.id, {
      apiKey: formApiKey,
      baseUrl: formBaseUrl,
      enabled: formEnabled,
    })
    setEditing(false)
  }

  const handleCancel = () => {
    setFormApiKey(model.apiKey)
    setFormBaseUrl(model.baseUrl)
    setFormEnabled(model.enabled)
    setEditing(false)
  }

  const handleDelete = async () => {
    await removeModel(model.id)
  }

  if (editing) {
    return (
      <Card className="w-full">
        <Card.Header>
          <div className="flex items-center justify-between w-full">
            <Card.Title>{model.modelName}</Card.Title>
            <span className="text-xs text-blue-500 font-medium">编辑中</span>
          </div>
        </Card.Header>
        <Card.Content className="space-y-3">
          {/* API Key */}
          <TextField value={formApiKey} onChange={setFormApiKey} type="password">
            <Label>API Key</Label>
            <Input placeholder="sk-..." />
          </TextField>

          {/* Base URL */}
          <TextField value={formBaseUrl} onChange={setFormBaseUrl}>
            <Label>Base URL</Label>
            <Input placeholder="https://api.openai.com/v1" />
          </TextField>

          {/* 启用开关 */}
          <Checkbox isSelected={formEnabled} onChange={setFormEnabled}>
            <Checkbox.Content>
              <Checkbox.Control>
                <Checkbox.Indicator />
              </Checkbox.Control>
              启用
            </Checkbox.Content>
          </Checkbox>
        </Card.Content>
        <Card.Footer className="flex gap-2">
          <Button size="sm" onPress={handleSave}>
            保存
          </Button>
          <Button size="sm" variant="secondary" onPress={handleCancel}>
            取消
          </Button>
        </Card.Footer>
      </Card>
    )
  }

  return (
    <Card className="w-full">
      <Card.Header>
        <div className="flex items-center gap-2">
          <span
            className={`inline-block w-2 h-2 rounded-full ${
              model.enabled ? 'bg-green-500' : 'bg-gray-300'
            }`}
            title={model.enabled ? '已启用' : '已禁用'}
          />
          <Card.Title>{model.modelName}</Card.Title>
        </div>
      </Card.Header>
      <Card.Content>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-500">
          <span>Provider: {model.providerName}</span>
          <span>Context: {model.contextWindow.toLocaleString()}</span>
          {model.supportsFunctionCalling && (
            <span className="text-blue-500 font-medium">支持 FC</span>
          )}
        </div>
      </Card.Content>
      <Card.Footer className="flex gap-1.5">
        <Button size="sm" variant="secondary" onPress={() => setEditing(true)}>
          设置
        </Button>
        <Button size="sm" variant="danger" onPress={handleDelete}>
          删除
        </Button>
      </Card.Footer>
    </Card>
  )
}

export default ModelCard
