/**
 * DefaultLLMConfigManager — LLM 配置管理器
 *
 * 负责 Provider 配置和路由配置的读写、持久化（SQLite）、热更新。
 */

import type { ILLMConfigManager, ProviderConfig, RouterConfig, ConfigChangeEvent } from '../types';
import { LLM_CONFIG_DEFAULTS, CONFIG_KEYS } from './llm-config';

/**
 * 配置管理器实现（使用自定义存储后端）
 * 不直接依赖 better-sqlite3，通过 StorageAdapter 抽象
 */
export interface StorageAdapter {
  get(key: string): string | undefined;
  set(key: string, value: string, valueType: string): void;
}

/** 内存存储适配器（默认，用于无 SQLite 环境） */
export class MemoryStorageAdapter implements StorageAdapter {
  private store: Map<string, { value: string; valueType: string }> = new Map();

  get(key: string): string | undefined {
    return this.store.get(key)?.value;
  }

  set(key: string, value: string, valueType: string): void {
    this.store.set(key, { value, valueType });
  }
}

export class DefaultLLMConfigManager implements ILLMConfigManager {
  private storage: StorageAdapter;
  private listeners: Array<(event: ConfigChangeEvent) => void> = [];

  constructor(storage?: StorageAdapter) {
    this.storage = storage || new MemoryStorageAdapter();
    this.ensureDefaults();
  }

  /** 确保默认配置存在 */
  private ensureDefaults(): void {
    if (!this.storage.get(CONFIG_KEYS.LLM_PROVIDERS)) {
      this.storage.set(CONFIG_KEYS.LLM_PROVIDERS, JSON.stringify(LLM_CONFIG_DEFAULTS.defaultProviderConfigs), 'json');
    }
    if (!this.storage.get(CONFIG_KEYS.LLM_ROUTER_DEFAULT)) {
      this.storage.set(CONFIG_KEYS.LLM_ROUTER_DEFAULT, JSON.stringify(LLM_CONFIG_DEFAULTS.defaultRouterConfig.default), 'json');
    }
    if (!this.storage.get(CONFIG_KEYS.LLM_ROUTER_TASK_TYPES)) {
      this.storage.set(CONFIG_KEYS.LLM_ROUTER_TASK_TYPES, JSON.stringify(LLM_CONFIG_DEFAULTS.defaultRouterConfig.taskTypes), 'json');
    }
    if (!this.storage.get(CONFIG_KEYS.LLM_ROUTER_FALLBACK)) {
      this.storage.set(CONFIG_KEYS.LLM_ROUTER_FALLBACK, JSON.stringify(LLM_CONFIG_DEFAULTS.defaultRouterConfig.fallback), 'json');
    }
  }

  async getProviderConfigs(): Promise<Record<string, ProviderConfig>> {
    const row = this.storage.get(CONFIG_KEYS.LLM_PROVIDERS);
    if (!row) return {};
    return JSON.parse(row);
  }

  async getProviderConfig(id: string): Promise<ProviderConfig | undefined> {
    const configs = await this.getProviderConfigs();
    return configs[id];
  }

  async updateProviderConfig(id: string, config: Partial<ProviderConfig>): Promise<void> {
    const configs = await this.getProviderConfigs();
    configs[id] = { ...configs[id], ...config } as ProviderConfig;
    this.storage.set(CONFIG_KEYS.LLM_PROVIDERS, JSON.stringify(configs), 'json');
    this.notify({ type: 'provider_updated', providerId: id, timestamp: Date.now() });
  }

  async removeProviderConfig(id: string): Promise<void> {
    const configs = await this.getProviderConfigs();
    delete configs[id];
    this.storage.set(CONFIG_KEYS.LLM_PROVIDERS, JSON.stringify(configs), 'json');
    this.notify({ type: 'provider_removed', providerId: id, timestamp: Date.now() });
  }

  async getRouterConfig(): Promise<RouterConfig> {
    const defaultRow = this.storage.get(CONFIG_KEYS.LLM_ROUTER_DEFAULT);
    const taskTypesRow = this.storage.get(CONFIG_KEYS.LLM_ROUTER_TASK_TYPES);
    const fallbackRow = this.storage.get(CONFIG_KEYS.LLM_ROUTER_FALLBACK);

    return {
      default: defaultRow ? JSON.parse(defaultRow) : LLM_CONFIG_DEFAULTS.defaultRouterConfig.default,
      taskTypes: taskTypesRow ? JSON.parse(taskTypesRow) : undefined,
      fallback: fallbackRow ? JSON.parse(fallbackRow) : LLM_CONFIG_DEFAULTS.defaultRouterConfig.fallback,
    };
  }

  async updateRouterConfig(config: Partial<RouterConfig>): Promise<void> {
    if (config.default) {
      this.storage.set(CONFIG_KEYS.LLM_ROUTER_DEFAULT, JSON.stringify(config.default), 'json');
    }
    if (config.taskTypes) {
      this.storage.set(CONFIG_KEYS.LLM_ROUTER_TASK_TYPES, JSON.stringify(config.taskTypes), 'json');
    }
    if (config.fallback) {
      this.storage.set(CONFIG_KEYS.LLM_ROUTER_FALLBACK, JSON.stringify(config.fallback), 'json');
    }
    this.notify({ type: 'router_updated', timestamp: Date.now() });
  }

  onConfigChanged(callback: (event: ConfigChangeEvent) => void): void {
    this.listeners.push(callback);
  }

  private notify(event: ConfigChangeEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // 监听器异常不影响正常流程
      }
    }
  }
}