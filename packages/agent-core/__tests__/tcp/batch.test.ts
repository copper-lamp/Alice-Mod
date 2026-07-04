import { describe, it, expect } from 'vitest';
import { isBatch, parseBatch, BatchCollector } from '../../src/main/tcp/batch';

describe('Batch (批量调用)', () => {
  describe('isBatch', () => {
    it('should identify a batch array', () => {
      expect(isBatch([{ jsonrpc: '2.0', id: 1, method: 'test' }])).toBe(true);
    });

    it('should reject empty array', () => {
      expect(isBatch([])).toBe(false);
    });

    it('should reject non-array', () => {
      expect(isBatch('string')).toBe(false);
      expect(isBatch(null)).toBe(false);
      expect(isBatch({})).toBe(false);
    });
  });

  describe('parseBatch', () => {
    it('should parse batch messages', () => {
      const requests = parseBatch([
        { jsonrpc: '2.0', id: 1, method: 'tool_call', params: { tool: 'a' } },
        { jsonrpc: '2.0', id: 2, method: 'tool_call', params: { tool: 'b' } },
      ]);

      expect(requests).toHaveLength(2);
      expect(requests[0].method).toBe('tool_call');
      expect(requests[1].id).toBe(2);
    });

    it('should skip invalid items in batch', () => {
      const requests = parseBatch([
        { jsonrpc: '2.0', id: 1, method: 'tool_call' },
        { invalid: true },
        { jsonrpc: '2.0', id: 3, method: 'status_update' },
      ]);

      expect(requests).toHaveLength(2);
    });
  });

  describe('BatchCollector', () => {
    it('should collect responses', () => {
      const requests = [
        { jsonrpc: '2.0' as const, id: 1, method: 'tool_call', params: {} },
        { jsonrpc: '2.0' as const, id: 2, method: 'tool_call', params: {} },
      ];
      const collector = new BatchCollector(requests);

      expect(collector.isComplete).toBe(false);
      expect(collector.collectedCount).toBe(0);

      collector.addResponse({ jsonrpc: '2.0', id: 1, result: { success: true } });
      expect(collector.collectedCount).toBe(1);
      expect(collector.isComplete).toBe(false);

      collector.addResponse({ jsonrpc: '2.0', id: 2, result: { success: true } });
      expect(collector.collectedCount).toBe(2);
      expect(collector.isComplete).toBe(true);
    });

    it('should return all collected responses', () => {
      const requests = [
        { jsonrpc: '2.0' as const, id: 1, method: 'test', params: {} },
      ];
      const collector = new BatchCollector(requests);
      const response = { jsonrpc: '2.0' as const, id: 1, result: { ok: true } };
      collector.addResponse(response);

      const responses = collector.getResponses();
      expect(responses).toHaveLength(1);
      expect(responses[0]).toEqual(response);
    });
  });
});
