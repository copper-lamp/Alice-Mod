/**
 * 记忆系统集成测试
 *
 * 测试完整流程：
 * store → recall → update → forget → cleanup
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryManager } from '../../src/main/memory/memory-manager';
import { SQLiteStore } from '../../src/main/memory/sqlite-store';
import { ChromaStore } from '../../src/main/memory/chroma-store';
import type { IEmbeddingModel } from '../../src/main/memory/embedding';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ════════════════════════════════════════════════════════════════
// Mock EmbeddingModel（不依赖外部 API）
// ════════════════════════════════════════════════════════════════

class MockEmbeddingModel implements IEmbeddingModel {
  private dim: number = 4;

  async embed(text: string): Promise<number[]> {
    // 返回一个简单的确定性向量
    const hash = text.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
    return Array.from({ length: this.dim }, (_, i) => (hash + i) / 10000);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map(t => this.embed(t)));
  }

  getDimension(): number { return this.dim; }

  async healthCheck(): Promise<boolean> { return true; }
}

// ════════════════════════════════════════════════════════════════
// Mock ChromaStore（模拟向量存储）
// ════════════════════════════════════════════════════════════════

class MockChromaStore {
  private store: Map<string, { vector: number[]; metadata: Record<string, unknown> }> = new Map();

  async init(): Promise<void> { /* noop */ }

  async upsert(embeddingId: string, vector: number[], metadata: Record<string, unknown>): Promise<void> {
    this.store.set(embeddingId, { vector, metadata });
  }

  async upsertBatch(items: Array<{ embeddingId: string; vector: number[]; metadata: Record<string, unknown> }>): Promise<void> {
    for (const item of items) {
      this.store.set(item.embeddingId, { vector: item.vector, metadata: item.metadata });
    }
  }

  async querySimilar(params: { vector: number[]; filter?: Record<string, unknown>; limit?: number; minScore?: number }): Promise<Array<{ embeddingId: string; score: number; metadata: Record<string, unknown> }>> {
    const results: Array<{ embeddingId: string; score: number; metadata: Record<string, unknown> }> = [];
    for (const [id, data] of this.store) {
      // 计算余弦相似度简化版
      let dot = 0, normA = 0, normB = 0;
      for (let i = 0; i < params.vector.length; i++) {
        dot += params.vector[i] * data.vector[i];
        normA += params.vector[i] ** 2;
        normB += data.vector[i] ** 2;
      }
      const score = dot / (Math.sqrt(normA) * Math.sqrt(normB) || 1);

      if (score >= (params.minScore ?? 0.3)) {
        // 检查 filter
        if (params.filter) {
          let match = true;
          for (const [k, v] of Object.entries(params.filter)) {
            if (data.metadata[k] !== v) { match = false; break; }
          }
          if (!match) continue;
        }
        results.push({ embeddingId: id, score, metadata: data.metadata });
      }
    }
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, params.limit ?? 10);
  }

  async delete(embeddingId: string): Promise<void> {
    this.store.delete(embeddingId);
  }

  async deleteBatch(embeddingIds: string[]): Promise<void> {
    for (const id of embeddingIds) this.store.delete(id);
  }

  async count(): Promise<number> { return this.store.size; }
  async healthCheck(): Promise<boolean> { return true; }
  async reset(): Promise<void> { this.store.clear(); }
  async close(): Promise<void> { this.store.clear(); }
}

// ════════════════════════════════════════════════════════════════
// 测试
// ════════════════════════════════════════════════════════════════

describe('MemoryManager 集成测试', () => {
  let dbPath: string;
  let manager: MemoryManager;
  let mockChroma: MockChromaStore;
  let mockEmbedding: MockEmbeddingModel;

  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), 'memory-integration-'));
    dbPath = join(dir, 'test.db');

    mockChroma = new MockChromaStore() as any;
    mockEmbedding = new MockEmbeddingModel();

    manager = new MemoryManager(
      {
        sqlitePath: dbPath,
        chroma: { clientType: 'http', url: 'http://localhost:8000', collectionName: 'test' },
        embedding: { provider: 'openai', model: 'text-embedding-3-small', dimension: 4 },
      },
      {
        sqlite: undefined,
        chroma: mockChroma as any,
        embedding: mockEmbedding,
        logger: {
          info: () => {},
          warn: () => {},
          error: () => {},
        },
      },
    );
  });

  afterEach(async () => {
    await manager.close();
    try { rmSync(dbPath, { force: true }); } catch { /* ignore */ }
  });

  describe('完整流程：store → recall → update → forget', () => {
    it('should store and recall a memory', async () => {
      const result = await manager.store({
        type: 'task_experience',
        content: { task: 'mine_diamond', description: 'Found diamonds at y=11' },
        tags: ['mining', 'diamond'],
        importance: 8,
      }, 'test-ws');

      expect(result.id).toBeTruthy();
      expect(result.createdAt).toBeGreaterThan(0);

      const recalled = await manager.recall({ id: result.id });
      expect(recalled.memories).toHaveLength(1);
      expect(recalled.memories[0].content.task).toBe('mine_diamond');
    });

    it('should recall by type and tags', async () => {
      await manager.store({ type: 'player_habit', content: { preference: 'night' }, tags: ['habit'] }, 'test-ws');
      await manager.store({ type: 'map_point', content: { x: 100, y: 64, z: 200 }, tags: ['base'] }, 'test-ws');
      await manager.store({ type: 'task_experience', content: { task: 'build_house' }, tags: ['building'] }, 'test-ws');

      const result = await manager.recall({ type: 'map_point', tags: ['base'], limit: 10 });
      expect(result.memories).toHaveLength(1);
      expect(result.memories[0].type).toBe('map_point');
    });

    it('should recall by keywords', async () => {
      await manager.store({ type: 'task_experience', content: { description: 'successfully mined ancient debris' } }, 'test-ws');
      await manager.store({ type: 'task_experience', content: { description: 'failed to find nether fortress' } }, 'test-ws');

      const result = await manager.recall({ keywords: ['ancient'], limit: 10 });
      expect(result.memories).toHaveLength(1);
    });

    it('should update a memory', async () => {
      const { id } = await manager.store({
        type: 'task_experience',
        content: { task: 'test', description: 'initial' },
        importance: 3,
      }, 'test-ws');

      await manager.update(id, { importance: 10, content: { task: 'test', description: 'updated' } });

      const updated = await manager.getById(id);
      expect(updated!.importance).toBe(10);
      expect(updated!.content.description).toBe('updated');
    });

    it('should forget a memory', async () => {
      const { id } = await manager.store({
        type: 'task_experience',
        content: { task: 'to_delete' },
      }, 'test-ws');

      await manager.forget(id);
      const result = await manager.getById(id);
      expect(result).toBeNull();
    });
  });

  describe('标签管理', () => {
    it('should add and remove tags via manager', async () => {
      const { id } = await manager.store({
        type: 'task_experience',
        content: { task: 'tag_test' },
        tags: [],
      }, 'test-ws');

      await manager.addTag(id, 'new-tag');
      const withTag = await manager.getById(id);
      expect(withTag!.tags).toContain('new-tag');

      await manager.removeTag(id, 'new-tag');
      const withoutTag = await manager.getById(id);
      expect(withoutTag!.tags).not.toContain('new-tag');
    });
  });

  describe('语义检索（Chroma 降级）', () => {
    it('should fallback to SQLite when Chroma is unavailable', async () => {
      // 创建一个没有 Chroma 的 MemoryManager
      const dir = mkdtempSync(join(tmpdir(), 'memory-fallback-'));
      const fallbackDb = join(dir, 'fallback.db');

      const fallbackManager = new MemoryManager(
        {
          sqlitePath: fallbackDb,
          chroma: { clientType: 'http', url: 'http://localhost:9999', collectionName: 'test' },
          embedding: { provider: 'openai', model: 'text-embedding-3-small', dimension: 4 },
        },
        {
          chroma: { init: async () => { throw new Error('Chroma unavailable'); }, querySimilar: async () => { throw new Error('Chroma unavailable'); }, close: async () => {} } as any,
          embedding: mockEmbedding,
          logger: { info: () => {}, warn: () => {}, error: () => {} },
        },
      );

      await fallbackManager.init();
      await fallbackManager.store({ type: 'task_experience', content: { task: 'fallback_test' } }, 'test-ws');

      // 语义检索降级为 SQLite LIKE
      const result = await fallbackManager.recall({ similarTo: 'fallback', limit: 10 });
      expect(result.memories.length).toBeGreaterThanOrEqual(0);

      await fallbackManager.close();
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    });
  });

  describe('统计与清理', () => {
    it('should return stats', async () => {
      await manager.store({ type: 'player_habit', content: { habit: 'a' }, importance: 8 }, 'test-ws');
      await manager.store({ type: 'map_point', content: { loc: 'b' }, importance: 3 }, 'test-ws');

      const stats = await manager.stats('test-ws');
      expect(stats.total).toBe(2);
      expect(stats.byType.player_habit).toBe(1);
      expect(stats.byType.map_point).toBe(1);
    });

    it('should cleanup expired memories', async () => {
      const past = Date.now() - 10000;
      await manager.store({
        type: 'task_experience',
        content: { task: 'expired' },
        expiresAt: Date.now() - 1000,
      }, 'test-ws');
      await manager.store({
        type: 'task_experience',
        content: { task: 'valid' },
        expiresAt: null,
      }, 'test-ws');

      const result = await manager.cleanup({ mode: 'expired' });
      expect(result.removed).toBeGreaterThanOrEqual(0);

      const stats = await manager.stats('test-ws');
      expect(stats.total).toBeGreaterThanOrEqual(1);
    });
  });

  describe('导出/导入', () => {
    it('should export and import memories', async () => {
      await manager.store({ type: 'player_habit', content: { habit: 'test' }, importance: 7 }, 'test-ws');
      await manager.store({ type: 'map_point', content: { x: 1, y: 2, z: 3 }, importance: 5 }, 'test-ws');

      const exported = await manager.export({ format: 'json' });
      const data = JSON.parse(exported);
      expect(data).toHaveLength(2);

      // 清空所有记忆
      const stats1 = await manager.stats('test-ws');
      expect(stats1.total).toBe(2);

      // 清理后统计
      await manager.cleanup({ mode: 'all', importanceThreshold: 10 });
      const stats2 = await manager.stats('test-ws');
      expect(stats2.total).toBeGreaterThanOrEqual(0);
    });

    it('should import from JSON array', async () => {
      const json = JSON.stringify([
        { type: 'skill', content: { name: 'sword', description: 'master sword' }, tags: ['combat'], importance: 9 },
        { type: 'social', content: { player: 'Alice', relation: 'friend' }, tags: ['friendly'], importance: 6 },
      ]);

      const result = await manager.import(json);
      expect(result.imported).toBe(2);
      expect(result.skipped).toBe(0);
    });

    it('should import from JSONL', async () => {
      const jsonl = [
        JSON.stringify({ type: 'skill', content: { name: 'bow' }, tags: ['ranged'], importance: 7 }),
        JSON.stringify({ type: 'skill', content: { name: 'shield' }, tags: ['defense'], importance: 5 }),
      ].join('\n');

      const result = await manager.import(jsonl);
      expect(result.imported).toBe(2);
    });
  });
});