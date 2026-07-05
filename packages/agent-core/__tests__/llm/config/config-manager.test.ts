/**
 * DefaultLLMConfigManager 单元测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DefaultLLMConfigManager, MemoryStorageAdapter } from '../../../src/main/llm/config/config-manager';
import type { ProviderConfig, ConfigChangeEvent } from '../../../src/main/llm/types';

describe('MemoryStorageAdapter', () => {
  let storage: MemoryStorageAdapter;

  beforeEach(() => {
    storage = new MemoryStorageAdapter();
  });

  it('set 和 get 应正常工作', () => {
    storage.set('key1', 'value1', 'string');
    expect(storage.get('key1')).toBe('value1');
  });

  it('不存在的 key 应返回 undefined', () => {
    expect(storage.get('nonexistent')).toBeUndefined();
  });

  it('覆盖已有值', () => {
    storage.set('key1', 'old', 'string');
    storage.set('key1', 'new', 'string');
    expect(storage.get('key1')).toBe('new');
  });
});

describe('DefaultLLMConfigManager', () => {
  let storage: MemoryStorageAdapter;
  let manager: DefaultLLMConfigManager;

  beforeEach(() => {
    storage = new MemoryStorageAdapter();
    manager = new DefaultLLMConfigManager(storage);
  });

  describe('初始化', () => {
    it('应创建默认配置', async () => {
      const configs = await manager.getProviderConfigs();
      expect(configs.openai).toBeDefined();
      expect(configs.claude).toBeDefined();
      expect(configs.gemini).toBeDefined();
      expect(configs.ollama).toBeDefined();
      expect(configs.openai.baseUrl).toBe('https://api.openai.com/v1');
    });

    it('应创建默认路由配置', async () => {
      const routerConfig = await manager.getRouterConfig();
      expect(routerConfig.default.providerId).toBe('openai');
      expect(routerConfig.fallback).toBeDefined();
    });
  });

  describe('getProviderConfigs()', () => {
    it('应返回所有 Provider 配置', async () => {
      const configs = await manager.getProviderConfigs();
      expect(Object.keys(configs)).toHaveLength(4);
    });
  });

  describe('getProviderConfig()', () => {
    it('应返回指定 Provider 的配置', async () => {
      const config = await manager.getProviderConfig('openai');
      expect(config).toBeDefined();
      expect(config!.defaultModel).toBe('gpt-4o');
    });

    it('不存在的 Provider 应返回 undefined', async () => {
      const config = await manager.getProviderConfig('nonexistent');
      expect(config).toBeUndefined();
    });
  });

  describe('updateProviderConfig()', () => {
    it('应更新 Provider 配置', async () => {
      await manager.updateProviderConfig('openai', { baseUrl: 'https://custom.openai.com', defaultModel: 'gpt-4o-mini' });

      const config = await manager.getProviderConfig('openai');
      expect(config!.baseUrl).toBe('https://custom.openai.com');
      expect(config!.defaultModel).toBe('gpt-4o-mini');
    });

    it('部分更新应保留其他字段', async () => {
      await manager.updateProviderConfig('openai', { defaultModel: 'gpt-4o-mini' });

      const config = await manager.getProviderConfig('openai');
      expect(config!.baseUrl).toBe('https://api.openai.com/v1'); // 保持不变
      expect(config!.defaultModel).toBe('gpt-4o-mini');
    });

    it('应触发 provider_updated 事件', async () => {
      const listener = vi.fn();
      manager.onConfigChanged(listener);

      await manager.updateProviderConfig('openai', { defaultModel: 'gpt-4o-mini' });
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0][0].type).toBe('provider_updated');
      expect(listener.mock.calls[0][0].providerId).toBe('openai');
    });
  });

  describe('removeProviderConfig()', () => {
    it('应删除 Provider 配置', async () => {
      await manager.removeProviderConfig('openai');
      const config = await manager.getProviderConfig('openai');
      expect(config).toBeUndefined();
    });

    it('应触发 provider_removed 事件', async () => {
      const listener = vi.fn();
      manager.onConfigChanged(listener);

      await manager.removeProviderConfig('openai');
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0][0].type).toBe('provider_removed');
    });
  });

  describe('getRouterConfig()', () => {
    it('应返回完整的路由配置', async () => {
      const routerConfig = await manager.getRouterConfig();
      expect(routerConfig.default).toBeDefined();
      expect(routerConfig.fallback).toBeDefined();
      expect(routerConfig.taskTypes).toBeDefined();
    });

    it('应包含默认任务类型路由', async () => {
      const routerConfig = await manager.getRouterConfig();
      expect(routerConfig.taskTypes!.complex).toBeDefined();
      expect(routerConfig.taskTypes!.simple).toBeDefined();
      expect(routerConfig.taskTypes!.chat).toBeDefined();
      expect(routerConfig.taskTypes!.planning).toBeDefined();
    });
  });

  describe('updateRouterConfig()', () => {
    it('应更新默认路由', async () => {
      await manager.updateRouterConfig({
        default: { providerId: 'gemini', model: 'gemini-2.0-flash', options: {} },
      });

      const routerConfig = await manager.getRouterConfig();
      expect(routerConfig.default.providerId).toBe('gemini');
    });

    it('应更新 fallback 策略', async () => {
      await manager.updateRouterConfig({
        fallback: {
          fallbacks: [{ providerId: 'ollama', model: 'qwen2.5:7b', options: {} }],
          conditions: { maxConsecutiveFailures: 5, timeoutThreshold: 300000 },
          recoveryCheckIntervalMs: 600000,
        },
      });

      const routerConfig = await manager.getRouterConfig();
      expect(routerConfig.fallback.fallbacks).toHaveLength(1);
      expect(routerConfig.fallback.conditions.maxConsecutiveFailures).toBe(5);
    });

    it('应触发 router_updated 事件', async () => {
      const listener = vi.fn();
      manager.onConfigChanged(listener);

      await manager.updateRouterConfig({
        default: { providerId: 'gemini', model: 'gemini-2.0-flash', options: {} },
      });
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0][0].type).toBe('router_updated');
    });
  });

  describe('onConfigChanged()', () => {
    it('应支持多个监听器', async () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      manager.onConfigChanged(listener1);
      manager.onConfigChanged(listener2);

      await manager.updateProviderConfig('openai', { defaultModel: 'gpt-4o-mini' });
      expect(listener1).toHaveBeenCalledTimes(1);
      expect(listener2).toHaveBeenCalledTimes(1);
    });

    it('监听器异常不应影响正常更新', async () => {
      manager.onConfigChanged(() => { throw new Error('listener error'); });

      await expect(
        manager.updateProviderConfig('openai', { defaultModel: 'gpt-4o-mini' }),
      ).resolves.not.toThrow();
    });
  });
});