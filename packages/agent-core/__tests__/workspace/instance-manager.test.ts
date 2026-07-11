import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { InstanceManager } from '../../src/main/instance/instance-manager';

describe('InstanceManager', () => {
  let tempDir: string;
  let manager: InstanceManager;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alice-mod-test-'));
    manager = new InstanceManager(path.join(tempDir, 'instances.json'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const validJson = JSON.stringify({
    schema_version: '1.0',
    instances: [
      {
        instance_id: 'server-1',
        name: 'Main Server',
        edition: 'bedrock',
        host: '192.168.1.100',
        port: 27541,
        auth_token: 'sk-abc123',
      },
    ],
  });

  describe('importFromJson', () => {
    it('should import valid JSON', () => {
      const result = manager.importFromJson(validJson);
      expect(result.success).toBe(true);
      expect(result.instances).toHaveLength(1);
      expect(manager.count).toBe(1);
    });

    it('should reject invalid JSON', () => {
      const result = manager.importFromJson('not json');
      expect(result.success).toBe(false);
    });

    it('should overwrite existing instance with same id', () => {
      manager.importFromJson(validJson);

      const updatedJson = JSON.stringify({
        schema_version: '1.0',
        instances: [
          {
            instance_id: 'server-1',
            name: 'Updated Server',
            edition: 'java',
            host: '10.0.0.1',
            port: 27542,
            auth_token: 'new-token',
          },
        ],
      });

      const result = manager.importFromJson(updatedJson);
      expect(result.success).toBe(true);
      expect(manager.count).toBe(1);

      const instance = manager.get('server-1')!;
      expect(instance.name).toBe('Updated Server');
    });
  });

  describe('importFromFile', () => {
    it('should import from file path', () => {
      const filePath = path.join(tempDir, 'test-instances.json');
      fs.writeFileSync(filePath, validJson, 'utf-8');

      const result = manager.importFromFile(filePath);
      expect(result.success).toBe(true);
      expect(manager.count).toBe(1);
    });

    it('should handle non-existent file', () => {
      const result = manager.importFromFile('/nonexistent/path.json');
      expect(result.success).toBe(false);
    });
  });

  describe('CRUD', () => {
    beforeEach(() => {
      manager.importFromJson(validJson);
    });

    it('should get all instances', () => {
      expect(manager.getAll()).toHaveLength(1);
    });

    it('should get instance by id', () => {
      const inst = manager.get('server-1');
      expect(inst).toBeDefined();
      expect(inst!.name).toBe('Main Server');
    });

    it('should add new instance', () => {
      const added = manager.add({
        instance_id: 'server-2',
        name: 'New Server',
        edition: 'java',
        host: '10.0.0.1',
        port: 27541,
        auth_token: 'token-2',
      });
      expect(added).toBe(true);
      expect(manager.count).toBe(2);
    });

    it('should reject duplicate on add', () => {
      const added = manager.add({
        instance_id: 'server-1',
        name: 'Duplicate',
        edition: 'bedrock',
        host: 'localhost',
        port: 27541,
        auth_token: 'dup',
      });
      expect(added).toBe(false);
    });

    it('should update existing instance', () => {
      const updated = manager.update('server-1', { name: 'Updated Name', port: 27542 });
      expect(updated).toBe(true);

      const inst = manager.get('server-1')!;
      expect(inst.name).toBe('Updated Name');
      expect(inst.port).toBe(27542);
    });

    it('should return false when updating non-existent', () => {
      expect(manager.update('no-such', { name: 'X' })).toBe(false);
    });

    it('should remove instance', () => {
      expect(manager.remove('server-1')).toBe(true);
      expect(manager.count).toBe(0);
    });

    it('should return false when removing non-existent', () => {
      expect(manager.remove('no-such')).toBe(false);
    });
  });

  describe('persistence', () => {
    it('should save and load', () => {
      manager.importFromJson(validJson);

      // Create a new manager with same storage path
      const manager2 = new InstanceManager(path.join(tempDir, 'instances.json'));
      manager2.load();

      expect(manager2.count).toBe(1);
      expect(manager2.get('server-1')!.name).toBe('Main Server');
    });

    it('should handle missing storage file', () => {
      const newManager = new InstanceManager(path.join(tempDir, 'nonexistent.json'));
      newManager.load();
      expect(newManager.count).toBe(0);
    });
  });
});
