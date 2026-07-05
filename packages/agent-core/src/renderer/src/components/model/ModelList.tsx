import React from 'react'
import { Table } from '@heroui/react'
import type { ModelConfigItem } from '../../lib/types'
import ModelCard from './ModelCard'

interface Props {
  models: ModelConfigItem[]
}

const providerLabels: Record<string, string> = {
  openai: 'OpenAI',
  claude: 'Claude',
  gemini: 'Gemini',
  ollama: 'Ollama (本地)',
  deepseek: 'DeepSeek',
  qwen: '通义千问',
  moonshot: '月之暗面 (Kimi)',
  zhipu: '智谱 (GLM)',
  ernie: '百度文心 (ERNIE)',
  doubao: '字节豆包',
  yi: '零一万物 (Yi)',
  baichuan: '百川 (Baichuan)',
  minimax: 'MiniMax',
  spark: '讯飞星火',
  sensechat: '商汤 (SenseChat)',
  stepfun: '阶跃星辰 (StepFun)',
}

/** 按 Provider 分组展示模型列表 */
const ModelList: React.FC<Props> = ({ models }) => {
  if (models.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-gray-400">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mb-3 text-gray-300">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <line x1="9" y1="9" x2="15" y2="15" /><line x1="15" y1="9" x2="9" y2="15" />
        </svg>
        <p className="text-sm">暂无模型配置，点击添加模型开始配置</p>
      </div>
    )
  }

  // 按 providerId 分组
  const groups = models.reduce<Record<string, ModelConfigItem[]>>((acc, model) => {
    const key = model.providerId
    if (!acc[key]) acc[key] = []
    acc[key].push(model)
    return acc
  }, {})

  return (
    <div className="space-y-6">
      {Object.entries(groups).map(([providerId, providerModels]) => (
        <div key={providerId}>
          <h3 className="text-sm font-semibold text-gray-700 mb-3 px-1">
            {providerLabels[providerId] || providerId}
          </h3>
          <Table>
            <Table.ScrollContainer>
              <Table.Content aria-label={`${providerId} models`}>
                <Table.Header>
                  <Table.Column isRowHeader>模型名称</Table.Column>
                  <Table.Column>Provider</Table.Column>
                  <Table.Column>Context Window</Table.Column>
                  <Table.Column>FC 支持</Table.Column>
                  <Table.Column>状态</Table.Column>
                  <Table.Column>操作</Table.Column>
                </Table.Header>
                <Table.Body>
                  {providerModels.map(model => (
                    <Table.Row key={model.id}>
                      <Table.Cell className="font-medium">{model.modelName}</Table.Cell>
                      <Table.Cell>{model.providerName}</Table.Cell>
                      <Table.Cell>{model.contextWindow.toLocaleString()}</Table.Cell>
                      <Table.Cell>
                        {model.supportsFunctionCalling ? (
                          <span className="text-blue-500 font-medium">是</span>
                        ) : (
                          <span className="text-gray-400">否</span>
                        )}
                      </Table.Cell>
                      <Table.Cell>
                        <span
                          className={`inline-flex items-center gap-1 text-xs ${
                            model.enabled ? 'text-green-600' : 'text-gray-400'
                          }`}
                        >
                          <span
                            className={`inline-block w-1.5 h-1.5 rounded-full ${
                              model.enabled ? 'bg-green-500' : 'bg-gray-300'
                            }`}
                          />
                          {model.enabled ? '已启用' : '已禁用'}
                        </span>
                      </Table.Cell>
                      <Table.Cell>
                        <ModelCard model={model} />
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Content>
            </Table.ScrollContainer>
          </Table>
        </div>
      ))}
    </div>
  )
}

export default ModelList
