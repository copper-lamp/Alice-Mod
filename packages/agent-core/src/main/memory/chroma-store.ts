/**
 * ChromaStore — 向量存储实现
 *
 * 基于 chromadb SDK 实现向量索引和语义检索。
 * 支持 HTTP 模式（连接外部 Chroma 服务）和连接健康检查。
 */

import { ChromaClient } from 'chromadb'
import type { Metadata, Where } from 'chromadb'
import type { ChromaConfig } from './types'

// ════════════════════════════════════════════════════════════════
// 接口定义
// ════════════════════════════════════════════════════════════════

export interface IChromaStore {
  init(): Promise<void>
  upsert(embeddingId: string, vector: number[], metadata: Record<string, unknown>): Promise<void>
  upsertBatch(items: Array<{ embeddingId: string; vector: number[]; metadata: Record<string, unknown> }>): Promise<void>
  querySimilar(params: { vector: number[]; filter?: Record<string, unknown>; limit?: number; minScore?: number }): Promise<Array<{ embeddingId: string; score: number; metadata: Record<string, unknown> }>>
  delete(embeddingId: string): Promise<void>
  deleteBatch(embeddingIds: string[]): Promise<void>
  count(): Promise<number>
  healthCheck(): Promise<boolean>
  reset(): Promise<void>
  close(): Promise<void>
}

// ════════════════════════════════════════════════════════════════
// ChromaStore 实现
// ════════════════════════════════════════════════════════════════

export class ChromaStore implements IChromaStore {
  private client: ChromaClient | null = null
  private collection: {
    upsert: (args: { ids: string[]; embeddings: number[][]; metadatas: Metadata[] }) => Promise<void>
    query: (args: { queryEmbeddings: number[][]; nResults?: number; where?: Where; include?: string[] }) => Promise<{ distances: number[][]; metadatas: Record<string, unknown>[][]; ids: string[][] }>
    delete: (args: { ids?: string[] }) => Promise<void>
    count: () => Promise<number>
  } | null = null
  private config: ChromaConfig
  private ready: boolean = false

  constructor(config: ChromaConfig) {
    this.config = config
  }

  async init(): Promise<void> {
    if (this.ready) return

    const collectionName = this.config.collectionName ?? 'mcagent_memories'

    try {
      // 初始化 Chroma 客户端
      this.client = new ChromaClient(
        this.config.clientType === 'http' && this.config.url
          ? { path: this.config.url }
          : undefined,
      )

      // 心跳检测
      await this.client.heartbeat()

      // 创建或获取集合
      const col = await this.client.getOrCreateCollection({ name: collectionName })

      // 封装集合操作
      this.collection = {
        upsert: async (args) => {
          await col.upsert({
            ids: args.ids,
            embeddings: args.embeddings,
            metadatas: args.metadatas as Metadata[],
          })
        },
        query: async (args) => {
          const result = await col.query({
            queryEmbeddings: args.queryEmbeddings,
            nResults: args.nResults,
            where: args.where,
            include: args.include as any,
          })
          return {
            distances: result.distances as number[][],
            metadatas: result.metadatas as Record<string, unknown>[][],
            ids: result.ids as unknown as string[][],
          }
        },
        delete: async (args) => {
          await col.delete({ ids: args.ids })
        },
        count: async () => {
          return col.count()
        },
      }

      this.ready = true
    } catch (err) {
      this.ready = false
      throw err
    }
  }

  // ══════════════════════════════════════════════════════════════
  // 向量操作
  // ══════════════════════════════════════════════════════════════

  async upsert(embeddingId: string, vector: number[], metadata: Record<string, unknown>): Promise<void> {
    if (!this.collection) throw new Error('ChromaStore not initialized')
    await this.collection.upsert({
      ids: [embeddingId],
      embeddings: [vector],
      metadatas: [metadata as Metadata],
    })
  }

  async upsertBatch(items: Array<{ embeddingId: string; vector: number[]; metadata: Record<string, unknown> }>): Promise<void> {
    if (!this.collection) throw new Error('ChromaStore not initialized')
    if (items.length === 0) return

    await this.collection.upsert({
      ids: items.map(i => i.embeddingId),
      embeddings: items.map(i => i.vector),
      metadatas: items.map(i => i.metadata as Metadata),
    })
  }

  async querySimilar(params: { vector: number[]; filter?: Record<string, unknown>; limit?: number; minScore?: number }): Promise<Array<{ embeddingId: string; score: number; metadata: Record<string, unknown> }>> {
    if (!this.collection) throw new Error('ChromaStore not initialized')

    const result = await this.collection.query({
      queryEmbeddings: [params.vector],
      nResults: params.limit ?? 10,
      where: params.filter as Where | undefined,
      include: ['distances' as const, 'metadatas' as const],
    })

    const ids = result.ids[0] ?? []
    const distances = result.distances[0] ?? []
    const metadatas = result.metadatas[0] ?? []

    const results: Array<{ embeddingId: string; score: number; metadata: Record<string, unknown> }> = []
    for (let i = 0; i < ids.length; i++) {
      // Chroma 返回的距离（L2 = 越小越相似），转换为相似度分数 0-1
      const distance = distances[i] as number
      const score = 1 / (1 + distance)
      const minScore = params.minScore ?? 0.3

      if (score >= minScore) {
        results.push({
          embeddingId: ids[i],
          score,
          metadata: (metadatas[i] ?? {}) as Record<string, unknown>,
        })
      }
    }

    return results
  }

  async delete(embeddingId: string): Promise<void> {
    if (!this.collection) throw new Error('ChromaStore not initialized')
    await this.collection.delete({ ids: [embeddingId] })
  }

  async deleteBatch(embeddingIds: string[]): Promise<void> {
    if (!this.collection) throw new Error('ChromaStore not initialized')
    if (embeddingIds.length === 0) return
    await this.collection.delete({ ids: embeddingIds })
  }

  // ══════════════════════════════════════════════════════════════
  // 管理方法
  // ══════════════════════════════════════════════════════════════

  async count(): Promise<number> {
    if (!this.collection) throw new Error('ChromaStore not initialized')
    return this.collection.count()
  }

  async healthCheck(): Promise<boolean> {
    try {
      if (!this.client) return false
      await this.client.heartbeat()
      return true
    } catch {
      return false
    }
  }

  async reset(): Promise<void> {
    if (!this.client) throw new Error('ChromaStore not initialized')
    await this.client.reset()
    this.ready = false
    this.collection = null
  }

  async close(): Promise<void> {
    // chromadb 客户端没有显式的 close 方法
    this.ready = false
    this.collection = null
    this.client = null
  }
}