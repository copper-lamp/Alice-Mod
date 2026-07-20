import React, { useEffect, useState } from 'react'
import { Table } from '@heroui/react'
import type { ModelConfigItem } from '../../lib/types'
import ModelCard from './ModelCard'

interface Props {
  models: ModelConfigItem[]
}

interface ProviderInfo {
  id: string
  name: string
  baseUrl: string
}

/** 模型列表表格 */
const ModelList: React.FC<Props> = ({ models }) => {
  const [providers, setProviders] = useState<Record<string, string>>({})

  useEffect(() => {
    // 从后端获取 Provider 列表
    window.electronAPI.invoke('provider:full-list')
      .then((raw) => {
        const list = (Array.isArray(raw) ? raw : []) as ProviderInfo[]
        const map: Record<string, string> = {}
        for (const p of list) {
          map[p.id] = p.name
        }
        setProviders(map)
      })
      .catch(() => {
        // 静默失败，使用 model.providerName 兜底
      })
  }, [])

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

  return (
    <div className="space-y-3">
      {/* 提示文字 */}
      <div className="flex items-center gap-2 px-1 py-2 text-xs text-gray-500 bg-blue-50/50 rounded-lg border border-blue-100">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-blue-400 shrink-0">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
        <span>在此管理您的模型配置。添加模型后即可在智能体配置中选择使用。</span>
      </div>

      <Table>
        <Table.ScrollContainer>
          <Table.Content aria-label="模型列表">
            <Table.Header>
              <Table.Column isRowHeader>模型</Table.Column>
              <Table.Column>服务商</Table.Column>
              <Table.Column>操作</Table.Column>
            </Table.Header>
            <Table.Body>
              {models.map(model => (
                <Table.Row key={model.id}>
                  <Table.Cell className="font-medium">{model.modelName}</Table.Cell>
                  <Table.Cell>{providers[model.providerId] || model.providerName}</Table.Cell>
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
  )
}

export default ModelList