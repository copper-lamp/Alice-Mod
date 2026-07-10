import React from 'react'
import { Button, Select, ListBox } from '@heroui/react'
import { useConfigStore, type ProviderConfig, type ModelParams, type TcpConfig } from '../../stores/configStore'

/** 配置面板 - LLM Provider + 模型参数 + TCP 配置 */
const ConfigPanel: React.FC = () => {
  const { configPanelOpen, closeConfigPanel } = useConfigStore()

  if (!configPanelOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-xl mx-4 flex flex-col max-h-[80vh] overflow-hidden">
        {/* 头部 */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 shrink-0">
          <h2 className="text-base font-semibold text-gray-800">设置</h2>
          <button
            onClick={closeConfigPanel}
            className="p-1 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* 内容 - 单一滚动容器 */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <TabsView />
        </div>

        {/* 底部 */}
        <div className="flex justify-end px-5 py-3 border-t border-gray-200 shrink-0">
          <Button variant="secondary" size="sm" onPress={closeConfigPanel}>
            关闭
          </Button>
        </div>
      </div>
    </div>
  )
}

/* ===== 标签页切换 ===== */
type TabId = 'provider' | 'params' | 'tcp'

const TABS: { id: TabId; label: string }[] = [
  { id: 'provider', label: 'LLM Provider' },
  { id: 'params', label: '模型参数' },
  { id: 'tcp', label: 'TCP 连接' }
]

const TabsView: React.FC = () => {
  const [activeTab, setActiveTab] = React.useState<TabId>('provider')

  return (
    <div>
      {/* 标签导航 */}
      <div className="flex gap-1 mb-4 border-b border-gray-200">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.id
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 标签内容 */}
      {activeTab === 'provider' && <ProviderSection />}
      {activeTab === 'params' && <ParamsSection />}
      {activeTab === 'tcp' && <TcpSection />}
    </div>
  )
}

/* ===== Provider 配置区 ===== */
const ProviderSection: React.FC = () => {
  const { providers, activeProviderId, updateProvider, setActiveProvider } = useConfigStore()
  const activeProvider = providers.find(p => p.id === activeProviderId) || providers[0]

  if (!activeProvider) return null

  return (
    <div className="space-y-4">
      {/* Provider 选择 */}
      <div>
        <label className="text-xs text-gray-500 font-medium mb-1.5 block">当前 Provider</label>
        <div className="flex gap-2 flex-wrap">
          {providers.map(p => (
            <button
              key={p.id}
              onClick={() => setActiveProvider(p.id)}
              className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                p.id === activeProviderId
                  ? 'bg-blue-500 text-white border-blue-500'
                  : p.enabled
                    ? 'bg-blue-50 text-blue-600 border-blue-200 hover:bg-blue-100'
                    : 'bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100'
              }`}
            >
              {p.name}
            </button>
          ))}
        </div>
      </div>

      {/* 启用开关 */}
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={activeProvider.enabled}
          onChange={e => updateProvider(activeProviderId, { enabled: e.target.checked })}
          className="w-4 h-4 rounded border-gray-300 text-blue-500 focus:ring-blue-400"
        />
        <span className="text-sm text-gray-700">启用 {activeProvider.name}</span>
      </label>

      {/* API Key */}
      <div>
        <label className="text-xs text-gray-500 font-medium mb-1 block">API Key</label>
        <input
          type="password"
          value={activeProvider.apiKey}
          onChange={e => updateProvider(activeProviderId, { apiKey: e.target.value })}
          placeholder="sk-..."
          className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400 bg-gray-50"
        />
      </div>

      {/* Base URL */}
      <div>
        <label className="text-xs text-gray-500 font-medium mb-1 block">Base URL</label>
        <input
          type="text"
          value={activeProvider.baseUrl}
          onChange={e => updateProvider(activeProviderId, { baseUrl: e.target.value })}
          placeholder="https://api.openai.com/v1"
          className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400 bg-gray-50"
        />
      </div>

      {/* 模型选择 */}
      <div>
        <label className="text-xs text-gray-500 font-medium mb-1 block">模型</label>
        <Select
          selectedKey={activeProvider.selectedModel}
          onSelectionChange={(key) => {
            if (key) {
              updateProvider(activeProviderId, { selectedModel: key.toString() })
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
              {activeProvider.models.map(m => (
                <ListBox.Item key={m} id={m} textValue={m}>
                  {m}
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
      </div>
    </div>
  )
}

/* ===== 模型参数区 ===== */
const PARAM_FIELDS: { key: keyof ModelParams; label: string; min: number; max: number; step: number }[] = [
  { key: 'temperature', label: 'Temperature', min: 0, max: 2, step: 0.1 },
  { key: 'maxTokens', label: 'Max Tokens', min: 256, max: 128000, step: 256 },
  { key: 'topP', label: 'Top P', min: 0, max: 1, step: 0.05 },
  { key: 'presencePenalty', label: 'Presence Penalty', min: -2, max: 2, step: 0.1 },
  { key: 'frequencyPenalty', label: 'Frequency Penalty', min: -2, max: 2, step: 0.1 }
]

const ParamsSection: React.FC = () => {
  const { modelParams, updateModelParams } = useConfigStore()

  return (
    <div className="space-y-4">
      {PARAM_FIELDS.map(field => (
        <div key={field.key}>
          <label className="text-xs text-gray-500 font-medium mb-1 block">
            {field.label}
            <span className="text-gray-400 ml-1">({modelParams[field.key]})</span>
          </label>
          <input
            type="range"
            min={field.min}
            max={field.max}
            step={field.step}
            value={modelParams[field.key]}
            onChange={e => updateModelParams({ [field.key]: parseFloat(e.target.value) } as any)}
            className="w-full accent-blue-500"
          />
          <div className="flex justify-between text-[10px] text-gray-400 mt-0.5">
            <span>{field.min}</span>
            <span>{field.max}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

/* ===== TCP 配置区 ===== */
const TcpSection: React.FC = () => {
  const { tcp, updateTcp } = useConfigStore()

  const TCP_FIELDS: { key: keyof TcpConfig; label: string; min: number; max: number; suffix: string }[] = [
    { key: 'port', label: '监听端口', min: 1024, max: 65535, suffix: '' },
    { key: 'heartbeatInterval', label: '心跳间隔', min: 5, max: 60, suffix: '秒' },
    { key: 'timeout', label: '超时时间', min: 10, max: 120, suffix: '秒' }
  ]

  return (
    <div className="space-y-4">
      {TCP_FIELDS.map(field => (
        <div key={field.key}>
          <label className="text-xs text-gray-500 font-medium mb-1 block">
            {field.label}
          </label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={field.min}
              max={field.max}
              value={tcp[field.key] as number}
              onChange={e => {
                let v = parseInt(e.target.value, 10)
                if (isNaN(v)) v = field.min
                if (v < field.min) v = field.min
                if (v > field.max) v = field.max
                updateTcp({ [field.key]: v } as any)
              }}
              className="flex-1 px-3 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400 bg-gray-50"
            />
            {field.suffix && <span className="text-xs text-gray-400">{field.suffix}</span>}
          </div>
        </div>
      ))}
    </div>
  )
}

export default ConfigPanel