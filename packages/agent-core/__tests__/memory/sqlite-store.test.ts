/**
 * SQLiteStore 单元测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLiteStore } from '../../src/main/memory/sqlite-store';
import type { Memory } from '../../src/main/memory/types';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function createTestMemory(overrides: Partial<Memory> = {}): Memory {
  const now = Date.now();
  return {
    id: overrides.id ?? `test-${now}-${Math.random().toString(36).slice(2, 8)}`,
    workspaceId: overrides.workspaceId ?? 'test-ws',
    type: overrides.type ?? 'task_experience',
    branch: overrides.branch ?? 'experience',
    content: overrides.content ?? { task: 'test', description: 'test memory' },
    tags: overrides.tags ?? ['test'],
    importance: overrides.importance ?? 5,
    accessCount: overrides.accessCount ?? 0,
    embeddingId: overrides.embeddingId ?? null,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    expiresAt: overrides.expiresAt ?? null,
  };
}

describe('SQLiteStore', () => {
  let dbPath: string;
  let store: SQLiteStore;

  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), 'memory-test-'));
    dbPath = join(dir, 'test.db');
    store = new SQLiteStore(dbPath);
  });

  afterEach(() => {
    store.close();
    try { rmSync(dbPath, { force: true }); } catch { /* ignore */ }
  });

  describe('CRUD', () => {
    it('should save and retrieve a memory', () => {
      const mem = createTestMemory();
      store.saveMeta(mem);
      const retrieved = store.getById(mem.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(mem.id);
      expect(retrieved!.type).toBe('task_experience');
      expect(retrieved!.content).toEqual(mem.content);
    });

    it('should return null for non-existent id', () => {
      expect(store.getById('non-existent')).toBeNull();
    });

    it('should update a memory', () => {
      const mem = createTestMemory();
      store.saveMeta(mem);

      store.updateMeta(mem.id, { importance: 10, tags: ['updated'] });
      const updated = store.getById(mem.id);
      expect(updated!.importance).toBe(10);
      expect(updated!.tags).toContain('updated');
    });

    it('should delete a memory', () => {
      const mem = createTestMemory();
      store.saveMeta(mem);
      store.deleteMeta(mem.id);
      expect(store.getById(mem.id)).toBeNull();
    });
  });

  describe('Query', () => {
    it('should query by type', () => {
      store.saveMeta(createTestMemory({ id: 'm1', type: 'player_habit' }));
      store.saveMeta(createTestMemory({ id: 'm2', type: 'map_point' }));

      const result = store.query({ type: 'player_habit', limit: 10 });
      expect(result.memories).toHaveLength(1);
      expect(result.memories[0].id).toBe('m1');
    });

    it('should query by tags', () => {
      store.saveMeta(createTestMemory({ id: 'm1', tags: ['important'] }));
      store.saveMeta(createTestMemory({ id: 'm2', tags: ['trivial'] }));

      const result = store.query({ tags: ['important'], limit: 10 });
      expect(result.memories).toHaveLength(1);
      expect(result.memories[0].id).toBe('m1');
    });

    it('should query by keywords', () => {
      store.saveMeta(createTestMemory({ id: 'm1', content: { description: 'diamond mining' } }));
      store.saveMeta(createTestMemory({ id: 'm2', content: { description: 'wood cutting' } }));

      const result = store.query({ keywords: ['diamond'], limit: 10 });
      expect(result.memories).toHaveLength(1);
      expect(result.memories[0].id).toBe('m1');
    });

    it('should query by importance', () => {
      store.saveMeta(createTestMemory({ id: 'm1', importance: 8 }));
      store.saveMeta(createTestMemory({ id: 'm2', importance: 3 }));

      const result = store.query({ minImportance: 5, limit: 10 });
      expect(result.memories).toHaveLength(1);
      expect(result.memories[0].id).toBe('m1');
    });

    it('should paginate results', () => {
      for (let i = 0; i < 10; i++) {
        store.saveMeta(createTestMemory({ id: `m${i}`, importance: 5 }));
      }

      const page1 = store.query({ limit: 3, offset: 0 });
      expect(page1.memories).toHaveLength(3);
      expect(page1.total).toBe(10);

      const page2 = store.query({ limit: 3, offset: 3 });
      expect(page2.memories).toHaveLength(3);
    });

    it('should query by id', () => {
      store.saveMeta(createTestMemory({ id: 'target-id' }));
      const result = store.query({ id: 'target-id' });
      expect(result.memories).toHaveLength(1);
      expect(result.memories[0].id).toBe('target-id');
    });
  });

  describe('Tags', () => {
    it('should add and remove tags', () => {
      const mem = createTestMemory({ id: 'tag-test', tags: [] });
      store.saveMeta(mem);

      store.addTag('tag-test', 'new-tag');
      const withTag = store.getById('tag-test');
      expect(withTag!.tags).toContain('new-tag');

      store.removeTag('tag-test', 'new-tag');
      const withoutTag = store.getById('tag-test');
      expect(withoutTag!.tags).not.toContain('new-tag');
    });

    it('should get memories by tag', () => {
      store.saveMeta(createTestMemory({ id: 'm1', tags: ['shared-tag'] }));
      store.saveMeta(createTestMemory({ id: 'm2', tags: ['shared-tag'] }));
      store.saveMeta(createTestMemory({ id: 'm3', tags: ['other'] }));

      const result = store.getByTag('shared-tag');
      expect(result).toHaveLength(2);
    });
  });

  describe('Batch operations', () => {
    it('should batch save memories', () => {
      const memories = [
        createTestMemory({ id: 'b1' }),
        createTestMemory({ id: 'b2' }),
        createTestMemory({ id: 'b3' }),
      ];
      store.saveMetaBatch(memories);

      expect(store.getById('b1')).not.toBeNull();
      expect(store.getById('b2')).not.toBeNull();
      expect(store.getById('b3')).not.toBeNull();
    });

    it('should batch delete by conditions', () => {
      for (let i = 0; i < 5; i++) {
        store.saveMeta(createTestMemory({ id: `d${i}`, type: 'player_habit', importance: 1 }));
      }
      store.saveMeta(createTestMemory({ id: 'keep', type: 'map_point', importance: 10 }));

      const deleted = store.deleteBy({ type: 'player_habit', minImportance: 2 });
      expect(deleted).toHaveLength(5);

      expect(store.getById('keep')).not.toBeNull();
    });

    it('should get unembedded memories', () => {
      store.saveMeta(createTestMemory({ id: 'embedded', embeddingId: 'vec-1' }));
      store.saveMeta(createTestMemory({ id: 'not-embedded', embeddingId: null }));

      const unembedded = store.getUnembedded();
      expect(unembedded).toHaveLength(1);
      expect(unembedded[0].id).toBe('not-embedded');
    });
  });

  describe('Stats', () => {
    it('should return correct statistics', () => {
      store.saveMeta(createTestMemory({ id: 's1', type: 'player_habit', importance: 8, tags: ['a'] }));
      store.saveMeta(createTestMemory({ id: 's2', type: 'map_point', importance: 3, tags: ['b'] }));
      store.saveMeta(createTestMemory({ id: 's3', type: 'task_experience', importance: 5, tags: ['c'] }));

      const stats = store.stats('test-ws');
      expect(stats.total).toBe(3);
      expect(stats.averageImportance).toBeGreaterThan(5);
      expect(stats.byType.player_habit).toBe(1);
      expect(stats.byType.map_point).toBe(1);
      expect(stats.byType.task_experience).toBe(1);
    });
  });
});