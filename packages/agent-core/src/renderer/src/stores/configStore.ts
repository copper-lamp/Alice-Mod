/** LLM Provider 配置 */
export interface ProviderConfig {
  id: string
  name: string
  apiKey: string
  baseUrl: string
  models: string[]
  selectedModel: string
  enabled: boolean
}

/** 模型参数 */
export interface ModelParams {
  temperature: number
  maxTokens: number
  topP: number
  presencePenalty: number
  frequencyPenalty: number
}

/** TCP 配置 */
export interface TcpConfig {
  port: number
  heartbeatInterval: number
  timeout: number
}

/** 完整配置状态 */
interface ConfigState {
  /* Provider 配置 */
  providers: ProviderConfig[]
  activeProviderId: string

  /* 模型参数 */
  modelParams: ModelParams

  /* TCP 配置 */
  tcp: TcpConfig

  /* 面板可见性 */
  configPanelOpen: boolean

  /* actions */
  openConfigPanel: () => void
  closeConfigPanel: () => void
  updateProvider: (id: string, partial: Partial<ProviderConfig>) => void
  setActiveProvider: (id: string) => void
  updateModelParams: (partial: Partial<ModelParams>) => void
  updateTcp: (partial: Partial<TcpConfig>) => void
  resetConfig: () => void
}

export type { ConfigState }

/** 默认 Provider 配置 */
const defaultProviders: ProviderConfig[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    apiKey: '',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
    selectedModel: 'gpt-4o-mini',
    enabled: true
  },
  {
    id: 'claude',
    name: 'Claude',
    apiKey: '',
    baseUrl: 'https://api.anthropic.com/v1',
    models: ['claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022'],
    selectedModel: 'claude-3-5-sonnet-20241022',
    enabled: false
  },
  {
    id: 'gemini',
    name: 'Gemini',
    apiKey: '',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    models: ['gemini-2.0-flash', 'gemini-1.5-pro'],
    selectedModel: 'gemini-2.0-flash',
    enabled: false
  },
  {
    id: 'ollama',
    name: 'Ollama (本地)',
    apiKey: '',
    baseUrl: 'http://127.0.0.1:11434',
    models: ['llama3', 'qwen2.5', 'mistral', 'codellama'],
    selectedModel: 'qwen2.5',
    enabled: false
  }
]

const defaultModelParams: ModelParams = {
  temperature: 0.7,
  maxTokens: 4096,
  topP: 0.9,
  presencePenalty: 0,
  frequencyPenalty: 0
}

const defaultTcp: TcpConfig = {
  port: 27541,
  heartbeatInterval: 10,
  timeout: 30
}

import { create } from 'zustand'

export const useConfigStore = create<ConfigState>((set) => ({
  providers: defaultProviders,
  activeProviderId: 'openai',
  modelParams: defaultModelParams,
  tcp: defaultTcp,
  configPanelOpen: false,

  openConfigPanel: () => set({ configPanelOpen: true }),
  closeConfigPanel: () => set({ configPanelOpen: false }),

  updateProvider: (id, partial) =>
    set(s => ({
      providers: s.providers.map(p =>
        p.id === id ? { ...p, ...partial } : p
      )
    })),

  setActiveProvider: id => set({ activeProviderId: id }),

  updateModelParams: partial =>
    set(s => ({ modelParams: { ...s.modelParams, ...partial } })),

  updateTcp: partial =>
    set(s => ({ tcp: { ...s.tcp, ...partial } })),

  resetConfig: () =>
    set({
      providers: defaultProviders.map(p => ({ ...p })),
      activeProviderId: 'openai',
      modelParams: { ...defaultModelParams },
      tcp: { ...defaultTcp }
    })
}))