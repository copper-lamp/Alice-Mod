import { describe, it, expect } from 'vitest';
import { HandshakeHandler } from '../../src/main/tcp/handshake';

describe('HandshakeHandler (握手认证)', () => {
  const handler = new HandshakeHandler('test-token');

  it('should accept valid handshake', () => {
    const result = handler.validate({
      instance_id: 'instance-1',
      auth_token: 'test-token',
      version: { protocol: '1.0.0', edition: 'bedrock' },
    });

    expect(result.valid).toBe(true);
    expect(result.instanceId).toBe('instance-1');
    expect(result.response).toBeDefined();
  });

  it('should accept java edition handshake', () => {
    const result = handler.validate({
      instance_id: 'je-instance',
      auth_token: 'test-token',
      version: { protocol: '1.0.0', edition: 'java' },
      mod: 'fabric-0.16.0',
    });

    expect(result.valid).toBe(true);
  });

  it('should reject invalid auth_token', () => {
    const result = handler.validate({
      instance_id: 'instance-1',
      auth_token: 'wrong-token',
      version: { protocol: '1.0.0', edition: 'bedrock' },
    });

    expect(result.valid).toBe(false);
    expect(result.response?.error?.code).toBe(-32001);
  });

  it('should reject missing auth_token', () => {
    const result = handler.validate({
      instance_id: 'instance-1',
      version: { protocol: '1.0.0', edition: 'bedrock' },
    });

    expect(result.valid).toBe(false);
    expect(result.response?.error?.code).toBe(-32001);
  });

  it('should reject missing instance_id', () => {
    const result = handler.validate({
      auth_token: 'test-token',
      version: { protocol: '1.0.0', edition: 'bedrock' },
    });

    expect(result.valid).toBe(false);
  });

  it('should reject missing version info', () => {
    const result = handler.validate({
      instance_id: 'instance-1',
      auth_token: 'test-token',
    });

    expect(result.valid).toBe(false);
  });

  it('should reject invalid edition', () => {
    const result = handler.validate({
      instance_id: 'instance-1',
      auth_token: 'test-token',
      version: { protocol: '1.0.0', edition: 'console' },
    });

    expect(result.valid).toBe(false);
  });

  it('should reject non-object params', () => {
    const result = handler.validate('not-an-object');
    expect(result.valid).toBe(false);
  });

  it('should return correct handshake result on success', () => {
    const result = handler.validate({
      instance_id: 'instance-1',
      auth_token: 'test-token',
      version: { protocol: '1.0.0', edition: 'bedrock' },
    });

    const res = result.response!;
    expect(res.jsonrpc).toBe('2.0');
    const data = res.result as Record<string, unknown>;
    expect(data.success).toBe(true);
    expect(data.version).toBe('1.0.0');
    expect(data.server_name).toBe('Alice Mod Agent Core');
  });
});
