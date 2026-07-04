import { describe, it, expect } from 'vitest';
import {
  isValidRequest,
  isValidResponse,
  isValidError,
  isValidBatchRequest,
  createRequest,
  createSuccessResponse,
  createErrorResponse,
} from '../src/protocol/index.js';

describe('protocol', () => {
  describe('isValidRequest', () => {
    it('should validate a correct request', () => {
      const req = { jsonrpc: '2.0', id: 1, method: 'handshake', params: {} };
      expect(isValidRequest(req)).toBe(true);
    });

    it('should reject null', () => {
      expect(isValidRequest(null)).toBe(false);
    });

    it('should reject non-object', () => {
      expect(isValidRequest('string')).toBe(false);
    });

    it('should reject request with wrong jsonrpc version', () => {
      const req = { jsonrpc: '1.0', id: 1, method: 'test' };
      expect(isValidRequest(req)).toBe(false);
    });

    it('should reject request without method', () => {
      const req = { jsonrpc: '2.0', id: 1 };
      expect(isValidRequest(req)).toBe(false);
    });

    it('should accept notification (no id)', () => {
      const notif = { jsonrpc: '2.0', method: 'register_tools' };
      expect(isValidRequest(notif)).toBe(true);
    });
  });

  describe('isValidResponse', () => {
    it('should validate a success response', () => {
      const res = { jsonrpc: '2.0', id: 1, result: { success: true } };
      expect(isValidResponse(res)).toBe(true);
    });

    it('should validate an error response', () => {
      const res = { jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'error' } };
      expect(isValidResponse(res)).toBe(true);
    });

    it('should reject null', () => {
      expect(isValidResponse(null)).toBe(false);
    });

    it('should reject response without id', () => {
      const res = { jsonrpc: '2.0', result: { success: true } };
      expect(isValidResponse(res)).toBe(false);
    });

    it('should reject response with id=null', () => {
      const res = { jsonrpc: '2.0', id: null, result: { success: true } };
      expect(isValidResponse(res)).toBe(false);
    });

    it('should reject response with neither result nor error', () => {
      const res = { jsonrpc: '2.0', id: 1 };
      expect(isValidResponse(res)).toBe(false);
    });

    it('should reject response with invalid error object', () => {
      const res = { jsonrpc: '2.0', id: 1, error: { message: 'no code' } };
      expect(isValidResponse(res)).toBe(false);
    });
  });

  describe('isValidError', () => {
    it('should validate a correct error object', () => {
      expect(isValidError({ code: -32000, message: 'error' })).toBe(true);
    });

    it('should reject null', () => {
      expect(isValidError(null)).toBe(false);
    });

    it('should reject error without code', () => {
      expect(isValidError({ message: 'error' })).toBe(false);
    });

    it('should reject error without message', () => {
      expect(isValidError({ code: -32000 })).toBe(false);
    });
  });

  describe('isValidBatchRequest', () => {
    it('should validate a batch of requests', () => {
      const batch = [
        { jsonrpc: '2.0', id: 1, method: 'tool_call' },
        { jsonrpc: '2.0', id: 2, method: 'tool_call' },
      ];
      expect(isValidBatchRequest(batch)).toBe(true);
    });

    it('should reject empty array', () => {
      expect(isValidBatchRequest([])).toBe(false);
    });

    it('should reject non-array', () => {
      expect(isValidBatchRequest('not-array')).toBe(false);
    });

    it('should reject batch with invalid request', () => {
      const batch = [{ jsonrpc: '2.0', id: 1, method: 'tool_call' }, { invalid: true }];
      expect(isValidBatchRequest(batch)).toBe(false);
    });
  });

  describe('createRequest', () => {
    it('should create a valid request with string id', () => {
      const req = createRequest('handshake', { token: 'abc' }, 'req-1');
      expect(req).toEqual({
        jsonrpc: '2.0',
        id: 'req-1',
        method: 'handshake',
        params: { token: 'abc' },
      });
    });

    it('should create a request without params', () => {
      const req = createRequest('ping');
      expect(req.jsonrpc).toBe('2.0');
      expect(req.method).toBe('ping');
      expect(req.params).toBeUndefined();
      expect(typeof req.id).toBe('string');
    });
  });

  describe('createSuccessResponse', () => {
    it('should create a success response', () => {
      const res = createSuccessResponse(1, { success: true, data: 'ok' });
      expect(res).toEqual({
        jsonrpc: '2.0',
        id: 1,
        result: { success: true, data: 'ok' },
      });
    });
  });

  describe('createErrorResponse', () => {
    it('should create an error response', () => {
      const res = createErrorResponse(1, -32000, 'Tool failed', { tool: 'test' });
      expect(res).toEqual({
        jsonrpc: '2.0',
        id: 1,
        error: { code: -32000, message: 'Tool failed', data: { tool: 'test' } },
      });
    });

    it('should create an error response without data', () => {
      const res = createErrorResponse(1, -32001, 'Auth failed');
      expect(res.error).toEqual({ code: -32001, message: 'Auth failed' });
      expect(res.error.data).toBeUndefined();
    });
  });
});
