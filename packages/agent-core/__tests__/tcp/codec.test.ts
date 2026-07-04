import { describe, it, expect } from 'vitest';
import {
  createRequest,
  encodeRequest,
  parseRequest,
  createSuccessResponse,
  createErrorResponse,
  encodeResponse,
  parseResponse,
  createNotification,
  encodeNotification,
  parseMessage,
  isRequest,
  isResponse,
  isNotification,
} from '../../src/main/tcp/codec';

describe('Codec (JSON-RPC 消息编解码)', () => {
  describe('createRequest', () => {
    it('should create a valid request with auto-generated id', () => {
      const req = createRequest('handshake', { token: 'abc' });
      expect(req.jsonrpc).toBe('2.0');
      expect(req.method).toBe('handshake');
      expect(req.params).toEqual({ token: 'abc' });
      expect(typeof req.id).toBe('string');
    });

    it('should create a request with custom id', () => {
      const req = createRequest('ping', undefined, 42);
      expect(req.id).toBe(42);
      expect(req.params).toBeUndefined();
    });
  });

  describe('encodeRequest', () => {
    it('should encode request as framed buffer', () => {
      const buf = encodeRequest('ping', undefined, 1);
      const parsed = JSON.parse(buf.toString().trim());
      expect(parsed.method).toBe('ping');
      expect(parsed.id).toBe(1);
    });
  });

  describe('parseRequest', () => {
    it('should parse a valid request JSON', () => {
      const req = parseRequest('{"jsonrpc":"2.0","id":1,"method":"test"}');
      expect(req.method).toBe('test');
      expect(req.id).toBe(1);
    });

    it('should throw on invalid request', () => {
      expect(() => parseRequest('{"jsonrpc":"2.0","id":1}')).toThrow();
    });
  });

  describe('createSuccessResponse', () => {
    it('should create a success response', () => {
      const res = createSuccessResponse(1, { success: true });
      expect(res.jsonrpc).toBe('2.0');
      expect(res.id).toBe(1);
      expect(res.result).toEqual({ success: true });
    });
  });

  describe('createErrorResponse', () => {
    it('should create an error response', () => {
      const res = createErrorResponse(1, -32001, 'Auth failed', { detail: 'bad token' });
      expect(res.error.code).toBe(-32001);
      expect(res.error.message).toBe('Auth failed');
      expect(res.error.data).toEqual({ detail: 'bad token' });
    });
  });

  describe('encodeResponse', () => {
    it('should encode response as framed buffer', () => {
      const res = createSuccessResponse(1, { success: true });
      const buf = encodeResponse(res);
      const parsed = JSON.parse(buf.toString().trim());
      expect(parsed.result).toEqual({ success: true });
    });
  });

  describe('parseResponse', () => {
    it('should parse a valid response JSON', () => {
      const res = parseResponse('{"jsonrpc":"2.0","id":1,"result":{"ok":true}}');
      expect(res.id).toBe(1);
      expect('result' in res).toBe(true);
    });

    it('should throw on invalid response', () => {
      expect(() => parseResponse('{"jsonrpc":"2.0","id":1}')).toThrow();
    });
  });

  describe('createNotification', () => {
    it('should create a notification without id', () => {
      const notif = createNotification('register_tools', { tools: [] });
      expect(notif.jsonrpc).toBe('2.0');
      expect(notif.method).toBe('register_tools');
      expect('id' in notif).toBe(false);
    });
  });

  describe('isRequest / isResponse / isNotification', () => {
    it('should identify a request', () => {
      expect(isRequest({ jsonrpc: '2.0', id: 1, method: 'test' })).toBe(true);
    });

    it('should identify a response', () => {
      expect(isResponse({ jsonrpc: '2.0', id: 1, result: {} })).toBe(true);
      expect(isResponse({ jsonrpc: '2.0', id: 1, error: { code: 0, message: '' } })).toBe(true);
    });

    it('should identify a notification', () => {
      expect(isNotification({ jsonrpc: '2.0', method: 'test' })).toBe(true);
    });

    it('should reject null/undefined', () => {
      expect(isRequest(null)).toBe(false);
      expect(isResponse(undefined)).toBe(false);
      expect(isNotification(null)).toBe(false);
    });
  });
});
