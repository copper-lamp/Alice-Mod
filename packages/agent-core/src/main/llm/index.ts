/**
 * LLM 模块 — V6 LLM Provider ×4 + ModelRouter
 *
 * 与大语言模型交互的统一接口，包括：
 * - Provider 抽象层（OpenAI / Claude / Gemini / Ollama）
 * - ProviderRegistry 注册管理
 * - ModelRouter 路由选择 + 降级策略
 * - ConfigManager 配置管理
 * - LLMObserver 调用观测
 */

// 类型定义
export * from './types';

// 基础 Provider
export { BaseProvider, ProviderError } from './providers/base-provider';

// 具体 Provider 实现
export { OpenAIProvider } from './providers/openai';
export { ClaudeProvider } from './providers/claude';
export { GeminiProvider } from './providers/gemini';
export { OllamaProvider } from './providers/ollama';

// 注册管理
export { ProviderRegistry, providerRegistry } from './registry/provider-registry';

// 路由
export { DefaultModelRouter } from './router/model-router';
export { createBuiltinRules, createTaskTypeRule } from './router/router-rules';
export { FallbackHandler } from './router/fallback-handler';

// 配置管理
export { DefaultLLMConfigManager, MemoryStorageAdapter } from './config/config-manager';
export type { StorageAdapter } from './config/config-manager';
export { LLM_CONFIG_DEFAULTS, CONFIG_KEYS } from './config/llm-config';

// 观测
export { DefaultLLMObserver, getLLMObserver, setLLMObserver, resetLLMObserver } from './observer/llm-observer';
export { MemoryObserverStore } from './observer/observer-store';
export { SqliteObserverStore } from './observer/sqlite-observer-store';
export type { IObserverStore } from './observer/observer-store';

// V20 §4.2 调度器（令牌桶限流 + 并发上限 + 优先级）
export { DefaultLlmRequestScheduler } from './scheduler/llm-request-scheduler';
export type {
  LlmRequestScheduler,
  SchedulePriority,
  ScheduleRequest,
  SchedulerStatus,
  SchedulerConfig,
  ProviderRateLimit,
  ProviderStat,
} from './scheduler/types';
export { PRIORITY_WEIGHT, DEFAULT_SCHEDULER_CONFIG } from './scheduler/types';

// V20 §4.5 启动引导（注册 Provider + 配置 Router）
export { bootstrapLlmSystem, resolveProviderClass } from './bootstrap';
export type { BootstrapDeps, BootstrapResult } from './bootstrap';