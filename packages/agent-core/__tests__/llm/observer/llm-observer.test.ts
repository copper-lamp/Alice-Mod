/**
 * DefaultLLMObserver 单元测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DefaultLLMObserver } from '../../../src/main/llm/observer/llm-observer';
import { MemoryObserverStore } from '../../../src/main/llm/observer/observer-store';
import type { LLMCallRecord, LLMResponse } from '../../../src/main/llm/types';

describe('DefaultLLMObserver', () => {
  let observer: DefaultLLMObserver;
  let store: MemoryObserverStore;

  beforeEach(() => {
    store = new MemoryObserverStore(1000);
    observer = new DefaultLLMObserver(store);
  });

  describe('record()', () => {
    it('应记录一条调用记录', () => {
      observer.record({
        requestId: 'r1', providerId: 'openai', model: 'gpt-4o',
        promptTokens: 10, completionTokens: 20, totalTokens: 30,
        durationMs: 100, success: true, finishReason: 'stop',
        timestamp: Date.now(),
      });

      expect(observer.recordCount).toBe(1);
    });
  });

  describe('wrap()', () => {
    it('成功调用应记录 usage 信息', async () => {
      const mockResponse: LLMResponse = {
        message: { role: 'assistant', content: 'ok' },
        usage: { promptTokens: 50, completionTokens: 30, totalTokens: 80 },
        model: 'gpt-4o', requestId: 'req_1', durationMs: 200,
        truncated: false, finishReason: 'stop',
      };

      const result = await observer.wrap('openai', 'gpt-4o', async () => mockResponse);

      expect(result).toBe(mockResponse);
      expect(observer.recordCount).toBe(1);

      const records = observer.query();
      expect(records[0].totalTokens).toBe(80);
      expect(records[0].success).toBe(true);
    });

    it('失败调用应记录错误信息', async () => {
      await expect(
        observer.wrap('openai', 'gpt-4o', async () => {
          throw new Error('API timeout');
        }),
      ).rejects.toThrow('API timeout');

      expect(observer.recordCount).toBe(1);
      const records = observer.query();
      expect(records[0].success).toBe(false);
      expect(records[0].error).toBe('API timeout');
    });

    it('非 LLMResponse 返回值应记录 0 usage', async () => {
      await observer.wrap('openai', 'gpt-4o', async () => 'just a string');

      const records = observer.query();
      expect(records[0].totalTokens).toBe(0);
      expect(records[0].success).toBe(true);
    });

    it('requestId 应包含 providerId 前缀', async () => {
      await observer.wrap('openai', 'gpt-4o', async () => ({ usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, finishReason: 'stop' }));

      const records = observer.query();
      expect(records[0].requestId).toMatch(/^llm_openai_\d+_\d+$/);
    });
  });

  describe('query()', () => {
    beforeEach(() => {
      const now = Date.now();
      observer.record({ requestId: 'r1', providerId: 'openai', model: 'gpt-4o', promptTokens: 10, completionTokens: 20, totalTokens: 30, durationMs: 100, success: true, finishReason: 'stop', timestamp: now - 1000 });
      observer.record({ requestId: 'r2', providerId: 'claude', model: 'sonnet', promptTokens: 5, completionTokens: 10, totalTokens: 15, durationMs: 200, success: true, finishReason: 'stop', timestamp: now });
      observer.record({ requestId: 'r3', providerId: 'openai', model: 'gpt-4o', promptTokens: 0, completionTokens: 0, totalTokens: 0, durationMs: 50, success: false, finishReason: 'error', error: 'timeout', timestamp: now - 500 });
    });

    it('不传过滤条件应返回所有记录', () => {
      expect(observer.query()).toHaveLength(3);
    });

    it('应支持按 providerId 过滤', () => {
      expect(observer.query({ providerId: 'openai' })).toHaveLength(2);
    });

    it('应支持按 success 过滤', () => {
      expect(observer.query({ success: true })).toHaveLength(2);
      expect(observer.query({ success: false })).toHaveLength(1);
    });
  });

  describe('getStats()', () => {
    it('空记录应返回零值', () => {
      const stats = observer.getStats();
      expect(stats.totalCalls).toBe(0);
      expect(stats.totalTokens).toBe(0);
      expect(stats.successRate).toBe(1);
    });

    it('应正确计算聚合统计', () => {
      observer.record({ requestId: 'r1', providerId: 'openai', model: 'gpt-4o', promptTokens: 10, completionTokens: 20, totalTokens: 30, durationMs: 100, success: true, finishReason: 'stop', timestamp: Date.now() });
      observer.record({ requestId: 'r2', providerId: 'openai', model: 'gpt-4o', promptTokens: 0, completionTokens: 0, totalTokens: 0, durationMs: 50, success: false, finishReason: 'error', error: 'err', timestamp: Date.now() });

      const stats = observer.getStats();
      expect(stats.totalCalls).toBe(2);
      expect(stats.totalTokens).toBe(30);
      expect(stats.successRate).toBe(0.5);
      expect(stats.byProvider.openai.callCount).toBe(2);
      expect(stats.byModel['gpt-4o'].callCount).toBe(2);
    });

    it('应支持时间范围过滤', () => {
      const now = Date.now();
      observer.record({ requestId: 'r1', providerId: 'openai', model: 'gpt-4o', promptTokens: 0, completionTokens: 0, totalTokens: 10, durationMs: 100, success: true, finishReason: 'stop', timestamp: now - 2000 });
      observer.record({ requestId: 'r2', providerId: 'openai', model: 'gpt-4o', promptTokens: 0, completionTokens: 0, totalTokens: 20, durationMs: 100, success: true, finishReason: 'stop', timestamp: now + 1000 });

      const stats = observer.getStats({ start: now - 1000, end: now + 500 });
      expect(stats.totalCalls).toBe(0);
    });

    it('应正确计算缓存的 tokens', () => {
      observer.record({ requestId: 'r1', providerId: 'openai', model: 'gpt-4o', promptTokens: 10, completionTokens: 20, totalTokens: 30, cachedTokens: 5, durationMs: 100, success: true, finishReason: 'stop', timestamp: Date.now() });

      const stats = observer.getStats();
      expect(stats.totalCachedTokens).toBe(5);
      expect(stats.totalTokens).toBe(30);
    });

    it('应按模型和 Provider 分别统计', () => {
      observer.record({ requestId: 'r1', providerId: 'openai', model: 'gpt-4o', promptTokens: 10, completionTokens: 20, totalTokens: 30, durationMs: 100, success: true, finishReason: 'stop', timestamp: Date.now() });
      observer.record({ requestId: 'r2', providerId: 'claude', model: 'sonnet', promptTokens: 5, completionTokens: 10, totalTokens: 15, durationMs: 200, success: true, finishReason: 'stop', timestamp: Date.now() });

      const stats = observer.getStats();
      expect(stats.byProvider.openai.callCount).toBe(1);
      expect(stats.byProvider.claude.callCount).toBe(1);
      expect(stats.byModel['gpt-4o'].callCount).toBe(1);
      expect(stats.byModel.sonnet.callCount).toBe(1);
      expect(stats.avgDurationMs).toBe(150); // (100 + 200) / 2
    });
  });

  describe('export()', () => {
    it('应导出所有记录', () => {
      observer.record({ requestId: 'r1', providerId: 'openai', model: 'gpt-4o', promptTokens: 0, completionTokens: 0, totalTokens: 0, durationMs: 100, success: true, finishReason: 'stop', timestamp: Date.now() });
      const exported = observer.export();
      expect(exported).toHaveLength(1);
    });
  });

  describe('onCallRecorded()', () => {
    it('新记录应触发监听器', () => {
      const listener = vi.fn();
      observer.onCallRecorded(listener);

      observer.record({ requestId: 'r1', providerId: 'openai', model: 'gpt-4o', promptTokens: 0, completionTokens: 0, totalTokens: 0, durationMs: 100, success: true, finishReason: 'stop', timestamp: Date.now() });

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0][0].requestId).toBe('r1');
    });

    it('多个监听器应都能收到通知', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      observer.onCallRecorded(listener1);
      observer.onCallRecorded(listener2);

      observer.record({ requestId: 'r1', providerId: 'openai', model: 'gpt-4o', promptTokens: 0, completionTokens: 0, totalTokens: 0, durationMs: 100, success: true, finishReason: 'stop', timestamp: Date.now() });

      expect(listener1).toHaveBeenCalledTimes(1);
      expect(listener2).toHaveBeenCalledTimes(1);
    });

    it('监听器异常不应影响正常流程', () => {
      observer.onCallRecorded(() => { throw new Error('listener error'); });

      expect(() => {
        observer.record({ requestId: 'r1', providerId: 'openai', model: 'gpt-4o', promptTokens: 0, completionTokens: 0, totalTokens: 0, durationMs: 100, success: true, finishReason: 'stop', timestamp: Date.now() });
      }).not.toThrow();
    });
  });

  describe('clear()', () => {
    it('应清空所有记录', () => {
      observer.record({ requestId: 'r1', providerId: 'openai', model: 'gpt-4o', promptTokens: 0, completionTokens: 0, totalTokens: 0, durationMs: 100, success: true, finishReason: 'stop', timestamp: Date.now() });
      expect(observer.recordCount).toBe(1);
      observer.clear();
      expect(observer.recordCount).toBe(0);
    });
  });
});