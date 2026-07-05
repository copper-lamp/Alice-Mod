/**
 * LLM 配置项定义 + 默认值
 */

import type { ProviderConfig, RouterConfig, FallbackStrategy, ResolvedModel } from '../types';

/** LLM 配置默认值 */
export const LLM_CONFIG_DEFAULTS = {
  /** 默认 Provider 配置 */
  defaultProviderConfigs: {
    openai: {
      baseUrl: 'https://api.openai.com/v1',
      defaultModel: 'gpt-4o',
      models: ['gpt-4o', 'gpt-4o-mini', 'o3-mini'],
      timeout: 60000,
      maxRetries: 3,
    } as ProviderConfig,

    claude: {
      baseUrl: 'https://api.anthropic.com/v1',
      defaultModel: 'claude-3-5-sonnet-20241022',
      models: ['claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022'],
      apiVersion: '2023-06-01',
      timeout: 60000,
      maxRetries: 3,
    } as ProviderConfig,

    gemini: {
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      defaultModel: 'gemini-2.0-flash',
      models: ['gemini-2.0-flash', 'gemini-2.0-flash-lite'],
      timeout: 60000,
      maxRetries: 3,
    } as ProviderConfig,

    ollama: {
      baseUrl: 'http://localhost:11434',
      defaultModel: 'qwen2.5:7b',
      models: ['qwen2.5:7b', 'deepseek-r1:7b', 'llama3:8b'],
      timeout: 120000,
      maxRetries: 2,
    } as ProviderConfig,
  },

  /** 默认路由配置 */
  defaultRouterConfig: {
    default: { providerId: 'openai', model: 'gpt-4o', options: { temperature: 0.7 } } as ResolvedModel,
    taskTypes: {
      complex: { providerId: 'openai', model: 'gpt-4o', options: { temperature: 0.5, maxTokens: 8192 } } as ResolvedModel,
      simple: { providerId: 'openai', model: 'gpt-4o-mini', options: { temperature: 0.3, maxTokens: 2048 } } as ResolvedModel,
      chat: { providerId: 'gemini', model: 'gemini-2.0-flash', options: { temperature: 0.7 } } as ResolvedModel,
      planning: { providerId: 'claude', model: 'claude-3-5-sonnet-20241022', options: { temperature: 0.2, maxTokens: 4096 } } as ResolvedModel,
    },
    fallback: {
      fallbacks: [
        { providerId: 'openai', model: 'gpt-4o-mini', options: {} },
        { providerId: 'ollama', model: 'qwen2.5:7b', options: {} },
      ],
      conditions: { maxConsecutiveFailures: 3, timeoutThreshold: 120000 },
      recoveryCheckIntervalMs: 300000,
    } as FallbackStrategy,
  } as RouterConfig,
};

/** SQLite config 表 key 定义 */
export const CONFIG_KEYS = {
  LLM_PROVIDERS: 'llm_providers',
  LLM_ROUTER_DEFAULT: 'llm_router_default',
  LLM_ROUTER_TASK_TYPES: 'llm_router_task_types',
  LLM_ROUTER_FALLBACK: 'llm_router_fallback',
} as const;