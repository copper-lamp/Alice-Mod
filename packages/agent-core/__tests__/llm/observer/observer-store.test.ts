/**
 * MemoryObserverStore 单元测试
 */
import { describe, it, expect } from 'vitest';
import { MemoryObserverStore } from '../../../src/main/llm/observer/observer-store';
import type { LLMCallRecord } from '../../../src/main/llm/types';

function createRecord(overrides: Partial<LLMCallRecord> = {}): LLMCallRecord {
  return {
    requestId: 'r1',
    providerId: 'openai',
    model: 'gpt-4o',
    promptTokens: 10,
    completionTokens: 20,
    totalTokens: 30,
    durationMs: 100,
    success: true,
    finishReason: 'stop',
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('MemoryObserverStore', () => {
  let store: MemoryObserverStore;

  beforeEach(() => {
    store = new MemoryObserverStore(100);
  });

  describe('push() 和 getAll()', () => {
    it('应存储记录', () => {
      store.push(createRecord());
      expect(store.length).toBe(1);
      expect(store.getAll()).toHaveLength(1);
    });

    it('超过最大记录数应丢弃最早的数据', () => {
      const smallStore = new MemoryObserverStore(3);
      smallStore.push(createRecord({ requestId: 'r1' }));
      smallStore.push(createRecord({ requestId: 'r2' }));
      smallStore.push(createRecord({ requestId: 'r3' }));
      smallStore.push(createRecord({ requestId: 'r4' }));

      expect(smallStore.length).toBe(3);
      const all = smallStore.getAll();
      expect(all[0].requestId).toBe('r2');
      expect(all[2].requestId).toBe('r4');
    });

    it('default maxRecords 应为 10000', () => {
      const defaultStore = new MemoryObserverStore();
      expect(defaultStore['maxRecords']).toBe(10000);
    });
  });

  describe('query()', () => {
    beforeEach(() => {
      const now = Date.now();
      store.push(createRecord({ requestId: 'r1', providerId: 'openai', model: 'gpt-4o', success: true, timestamp: now - 1000 }));
      store.push(createRecord({ requestId: 'r2', providerId: 'claude', model: 'sonnet', success: true, timestamp: now }));
      store.push(createRecord({ requestId: 'r3', providerId: 'openai', model: 'gpt-4o', success: false, timestamp: now - 500 }));
    });

    it('无过滤应返回所有记录', () => {
      expect(store.query()).toHaveLength(3);
    });

    it('应按 providerId 过滤', () => {
      const results = store.query({ providerId: 'openai' });
      expect(results).toHaveLength(2);
      expect(results.every(r => r.providerId === 'openai')).toBe(true);
    });

    it('应按 model 过滤', () => {
      const results = store.query({ model: 'gpt-4o' });
      expect(results).toHaveLength(2);
    });

    it('应按 success 过滤', () => {
      const results = store.query({ success: true });
      expect(results).toHaveLength(2);
    });

    it('应按时间范围过滤', () => {
      const now = Date.now();
      const results = store.query({ startTime: now - 800, endTime: now + 100 });
      expect(results).toHaveLength(2);
    });

    it('应按 limit 和 offset 分页', () => {
      const results = store.query({ limit: 1, offset: 0 });
      expect(results).toHaveLength(1);
    });

    it('多条件组合过滤', () => {
      const results = store.query({ providerId: 'openai', success: true });
      expect(results).toHaveLength(1);
      expect(results[0].requestId).toBe('r1');
    });
  });

  describe('clear()', () => {
    it('应清空所有记录', () => {
      store.push(createRecord());
      store.push(createRecord());
      store.clear();
      expect(store.length).toBe(0);
      expect(store.getAll()).toHaveLength(0);
    });
  });

  describe('getAll()', () => {
    it('应返回记录的副本', () => {
      store.push(createRecord());
      const all = store.getAll();
      all.push(createRecord()); // 修改副本
      expect(store.length).toBe(1); // 原数据不受影响
    });
  });
});