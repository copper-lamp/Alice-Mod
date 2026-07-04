import { describe, it, expect } from 'vitest';
import { InstanceValidator } from '../../src/main/instance/instance-validator';

describe('InstanceValidator', () => {
  const validInstance = {
    instance_id: 'server-1',
    name: 'Main Server',
    edition: 'bedrock',
    host: '192.168.1.100',
    port: 27541,
    auth_token: 'sk-abc123',
    description: 'Main survival server',
    tags: ['survival', 'main'],
  };

  const validFile = {
    schema_version: '1.0',
    instances: [validInstance],
  };

  describe('validate (full file)', () => {
    it('should accept valid file', () => {
      const result = InstanceValidator.validate(validFile);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should reject non-object', () => {
      expect(InstanceValidator.validate(null).valid).toBe(false);
      expect(InstanceValidator.validate('string').valid).toBe(false);
    });

    it('should reject missing schema_version', () => {
      const result = InstanceValidator.validate({ instances: [] });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('schema_version');
    });

    it('should reject unsupported schema version', () => {
      const result = InstanceValidator.validate({ schema_version: '0.5', instances: [] });
      expect(result.valid).toBe(false);
    });

    it('should reject missing instances array', () => {
      const result = InstanceValidator.validate({ schema_version: '1.0' });
      expect(result.valid).toBe(false);
    });

    it('should reject empty instances array', () => {
      const result = InstanceValidator.validate({ schema_version: '1.0', instances: [] });
      expect(result.valid).toBe(false);
    });
  });

  describe('validateInstance', () => {
    it('should accept valid instance', () => {
      const errors = InstanceValidator.validateInstance(validInstance);
      expect(errors).toEqual([]);
    });

    it('should reject missing instance_id', () => {
      const { instance_id, ...rest } = validInstance;
      const errors = InstanceValidator.validateInstance(rest);
      expect(errors.some((e) => e.includes('instance_id'))).toBe(true);
    });

    it('should reject missing name', () => {
      const { name, ...rest } = validInstance;
      const errors = InstanceValidator.validateInstance(rest);
      expect(errors.some((e) => e.includes('name'))).toBe(true);
    });

    it('should reject invalid edition', () => {
      const errors = InstanceValidator.validateInstance({ ...validInstance, edition: 'console' });
      expect(errors.some((e) => e.includes('edition'))).toBe(true);
    });

    it('should reject invalid port', () => {
      const errors = InstanceValidator.validateInstance({ ...validInstance, port: 99999 });
      expect(errors.some((e) => e.includes('port'))).toBe(true);
    });

    it('should reject missing host', () => {
      const { host, ...rest } = validInstance;
      const errors = InstanceValidator.validateInstance(rest);
      expect(errors.some((e) => e.includes('host'))).toBe(true);
    });

    it('should detect duplicate instance_id', () => {
      const seenIds = new Set<string>(['server-1']);
      const errors = InstanceValidator.validateInstance(validInstance, seenIds);
      expect(errors.some((e) => e.includes('Duplicate'))).toBe(true);
    });

    it('should accept instance without optional fields', () => {
      const { description, tags, ...minimal } = validInstance;
      const errors = InstanceValidator.validateInstance(minimal);
      expect(errors).toEqual([]);
    });

    it('should reject non-object instance', () => {
      const errors = InstanceValidator.validateInstance(null);
      expect(errors.length).toBeGreaterThan(0);
    });
  });

  describe('validateJsonString', () => {
    it('should parse and validate valid JSON', () => {
      const result = InstanceValidator.validateJsonString(JSON.stringify(validFile));
      expect(result.valid).toBe(true);
    });

    it('should reject invalid JSON', () => {
      const result = InstanceValidator.validateJsonString('not json');
      expect(result.valid).toBe(false);
    });
  });

  describe('toInstanceConfig', () => {
    it('should convert raw object to InstanceConfig', () => {
      const config = InstanceValidator.toInstanceConfig(validInstance);
      expect(config.instance_id).toBe('server-1');
      expect(config.edition).toBe('bedrock');
      expect(config.port).toBe(27541);
      expect(config.tags).toEqual(['survival', 'main']);
    });
  });
});
