/**
 * MemoryManager — 记忆系统统一 API
 *
 * 封装 SQLiteStore + ChromaStore + EmbeddingModel，提供 14 个公开方法：
 *   store / batchStore / recall / getById / getSimilar / list
 *   update / forget / addTag / removeTag
 *   stats / cleanup / export / import
 */

import { randomUUID } from 'node:crypto'
import { SQLiteStore } from './sqlite-store'
import { ChromaStore } from './chroma-store'
import { EmbeddingStrategy, createEmbeddingModel } from './embedding'
import type { IEmbeddingModel } from './embedding'
import { MapIndex } from './map-index'
import { MapSync } from './map-sync'
import type {
  Memory, MemoryConfig, MemoryType, MemoryBranch,
  StoreParams, StoreResult, BatchStoreParams, BatchStoreResult,
  RecallParams, RecallResult, SimilarParams, SimilarResult,
  ListParams, ListResult, ForgetByParams,
  MemoryStats, CleanupOptions, CleanupResult, CleanupDetail,
  ExportOptions, ImportResult,
} from './types'

// ════════════════════════════════════════════════════════════════
// MemoryManager 类
// ════════════════════════════════════════════════════════════════

export class MemoryManager {
  public readonly sqlite: SQLiteStore
  public readonly chroma: ChromaStore
  public readonly embedding: IEmbeddingModel
  public readonly mapIndex: MapIndex
  public readonly mapSync: MapSync

  /** Chroma 是否可用（不可用时跳过嵌入和 MapSync） */
  private chromaAvailable: boolean = false

  private config: MemoryConfig
  private logger: { warn: (msg: string, err?: unknown) => void; info: (msg: string) => void; error: (msg: string, err?: unknown) => void }

  constructor(
    config: MemoryConfig,
    deps?: {
      sqlite?: SQLiteStore
      chroma?: ChromaStore
      embedding?: IEmbeddingModel
      mapIndex?: MapIndex
      logger?: { warn: (msg: string, err?: unknown) => void; info: (msg: string) => void; error: (msg: string, err?: unknown) => void }
    },
  ) {
    this.config = config
    this.logger = deps?.logger ?? {
      warn: (msg) => console.warn(`[MemoryManager] ${msg}`),
      info: (msg) => console.info(`[MemoryManager] ${msg}`),
      error: (msg, err) => console.error(`[MemoryManager] ${msg}`, err),
    }

    // 允许依赖注入（便于测试）
    this.sqlite = deps?.sqlite ?? new SQLiteStore(config.sqlitePath)
    this.chroma = deps?.chroma ?? new ChromaStore(config.chroma)
    this.embedding = deps?.embedding ?? createEmbeddingModel(config.embedding)
    this.mapIndex = deps?.mapIndex ?? new MapIndex(this.sqlite, this.logger)
    this.mapSync = new MapSync(this.mapIndex)
  }

  // ══════════════════════════════════════════════════════════════
  // 初始化
  // ══════════════════════════════════════════════════════════════

  async init(): Promise<void> {
    this.sqlite.init()
    try {
      await this.chroma.init()
      this.chromaAvailable = true
    } catch (err) {
      this.chromaAvailable = false
      this.logger.warn('ChromaStore 初始化失败，语义检索将降级为 SQLite LIKE 搜索', err)
    }
    // V12: 全量加载地图索引到内存（仅在 Chroma 可用时加载）
    if (this.chromaAvailable) {
      try {
        await this.mapIndex.load()
      } catch (err) {
        this.logger.warn('MapIndex 加载失败，地图查询将不可用', err)
      }
    }
  }

  // ══════════════════════════════════════════════════════════════
  // 存储
  // ══════════════════════════════════════════════════════════════

  private buildMemory(params: StoreParams, workspaceId: string): Memory {
    const now = Date.now()
    return {
      id: randomUUID(),
      workspaceId,
      type: params.type,
      branch: params.branch ?? 'experience',
      content: params.content,
      tags: params.tags ?? [],
      importance: params.importance ?? 5,
      accessCount: 0,
      embeddingId: null,
      createdAt: now,
      updatedAt: now,
      expiresAt: params.expiresAt ?? null,
    }
  }

  async store(params: StoreParams, workspaceId?: string): Promise<StoreResult> {
    const memory = this.buildMemory(params, workspaceId ?? 'default')

    // 1. 写入 SQLite
    this.sqlite.saveMeta(memory)

    // 2. 尝试生成向量并写入 Chroma（仅 Chroma 可用时）
    if (this.chromaAvailable) {
      await this.tryEmbed(memory)
    }

    // 3. V12: MapSync 自动同步空间索引（仅 Chroma 可用时）
    if (this.chromaAvailable) {
      try {
        await this.mapSync.onMemoryStored(memory)
      } catch (err) {
        this.logger.warn(`MapSync 同步失败: ${memory.id}`, err)
      }
    }

    this.logger.info(`记忆存储成功: ${memory.id} (${memory.type})`)
    return { id: memory.id, createdAt: memory.createdAt }
  }

  async batchStore(params: BatchStoreParams, workspaceId?: string): Promise<BatchStoreResult> {
    const memories = params.items.map(p => this.buildMemory(p, workspaceId ?? 'default'))

    // 1. 批量写入 SQLite
    this.sqlite.saveMetaBatch(memories)

    // 2. 批量尝试生成向量（仅 Chroma 可用时）
    if (this.chromaAvailable) {
      const toEmbed = memories.filter(m => m.content && Object.keys(m.content).length > 0)
      for (const memory of toEmbed) {
        await this.tryEmbed(memory)
      }
    }

    this.logger.info(`批量记忆存储成功: ${memories.length} 条`)
    return {
      ids: memories.map(m => m.id),
      count: memories.length,
    }
  }

  /**
   * 尝试生成向量并写入 Chroma（失败时降级，仅打日志）
   */
  private async tryEmbed(memory: Memory): Promise<void> {
    try {
      const text = EmbeddingStrategy.buildEmbeddingText(memory)
      const vector = await this.embedding.embed(text)
      const embeddingId = memory.id

      await this.chroma.upsert(embeddingId, vector, {
        memory_id: memory.id,
        workspace_id: memory.workspaceId,
        type: memory.type,
        branch: memory.branch,
        importance: memory.importance,
        created_at: memory.createdAt,
      })

      this.sqlite.markEmbedded(memory.id, embeddingId)
    } catch (err) {
      this.logger.warn(`记忆 ${memory.id} 嵌入失败，后续由 CleanupEngine 重试`, err)
    }
  }

  // ══════════════════════════════════════════════════════════════
  // 检索
  // ══════════════════════════════════════════════════════════════

  async recall(params: RecallParams): Promise<RecallResult> {
    // 语义检索
    if (params.similarTo) {
      const similarResult = await this.getSimilar({
        query: params.similarTo,
        type: params.type,
        branch: params.branch,
        workspaceId: params.workspaceId,
        limit: params.limit,
      })
      return {
        memories: similarResult.memories,
        total: similarResult.memories.length,
        limit: params.limit ?? 10,
        offset: 0,
      }
    }

    // ID 精确查询
    if (params.id) {
      const memory = this.sqlite.getById(params.id)
      if (!memory) {
        return { memories: [], total: 0, limit: 1, offset: 0 }
      }
      return { memories: [memory], total: 1, limit: 1, offset: 0 }
    }

    // 条件检索
    return this.sqlite.query(params)
  }

  async getById(id: string): Promise<Memory | null> {
    return this.sqlite.getById(id)
  }

  async getSimilar(params: SimilarParams): Promise<SimilarResult> {
    try {
      // 1. 生成查询向量
      const vector = await this.embedding.embed(params.query)

      // 2. Chroma 语义搜索
      const filter: Record<string, unknown> = {}
      if (params.workspaceId) filter.workspace_id = params.workspaceId
      if (params.type) filter.type = params.type
      if (params.branch) filter.branch = params.branch

      const results = await this.chroma.querySimilar({
        vector,
        filter: Object.keys(filter).length > 0 ? filter : undefined,
        limit: params.limit ?? 10,
        minScore: params.minScore ?? 0.5,
      })

      // 3. 回补 SQLite 元数据
      const memoryIds = results.map(r => r.metadata.memory_id as string)
      const memories = this.sqlite.getByIds(memoryIds)

      // 4. 合并相似度分数
      const scoreMap = new Map(results.map(r => [r.metadata.memory_id as string, r.score]))
      const scored = memories.map(m => ({
        ...m,
        similarityScore: scoreMap.get(m.id) ?? 0,
      }))

      return { memories: scored }
    } catch (err) {
      // Chroma 降级：SQLite LIKE 搜索
      this.logger.warn('Chroma 语义检索失败，降级为 SQLite LIKE 搜索', err)
      const result = this.sqlite.query({
        keywords: params.query.split(/\s+/).filter(Boolean),
        type: params.type,
        workspaceId: params.workspaceId,
        limit: params.limit ?? 10,
      })
      return {
        memories: result.memories.map(m => ({ ...m, similarityScore: 0 })),
      }
    }
  }

  async list(params: ListParams): Promise<ListResult> {
    return this.sqlite.list(params)
  }

  // ══════════════════════════════════════════════════════════════
  // 更新 / 删除
  // ══════════════════════════════════════════════════════════════

  async update(id: string, updates: Partial<Memory>): Promise<void> {
    const existing = this.sqlite.getById(id)
    if (!existing) {
      this.logger.warn(`更新失败：记忆 ${id} 不存在`)
      return
    }

    // 更新 SQLite
    this.sqlite.updateMeta(id, updates)

    // 如果内容变更，重新生成向量
    if (updates.content) {
      const merged: Memory = { ...existing, ...updates, id, updatedAt: Date.now() }
      merged.tags = updates.tags ?? existing.tags
      merged.content = updates.content ?? existing.content

      // 删除旧向量
      if (existing.embeddingId) {
        try {
          await this.chroma.delete(existing.embeddingId)
        } catch (err) {
          this.logger.warn(`删除旧向量失败: ${existing.embeddingId}`, err)
        }
      }

      // 生成新向量
      await this.tryEmbed(merged)
    }

    // V12: MapSync 同步更新空间索引
    const updatedMemory = this.sqlite.getById(id)
    if (updatedMemory) {
      try {
        await this.mapSync.onMemoryUpdated(updatedMemory)
      } catch (err) {
        this.logger.warn(`MapSync 更新同步失败: ${id}`, err)
      }
    }

    this.logger.info(`记忆更新成功: ${id}`)
  }

  async forget(id: string): Promise<void> {
    const existing = this.sqlite.getById(id)
    if (!existing) return

    // 删除 Chroma 向量
    if (existing.embeddingId) {
      try {
        await this.chroma.delete(existing.embeddingId)
      } catch (err) {
        this.logger.warn(`删除 Chroma 向量失败: ${existing.embeddingId}`, err)
      }
    }

    // V12: MapSync 同步删除空间索引（放在 SQLite 删除前，以便获取 memoryId）
    try {
      await this.mapSync.onMemoryForgotten(id)
    } catch (err) {
      this.logger.warn(`MapSync 删除同步失败: ${id}`, err)
    }

    // 删除 SQLite 记录
    this.sqlite.deleteMeta(id)
    this.logger.info(`记忆删除成功: ${id}`)
  }

  // ══════════════════════════════════════════════════════════════
  // 标签管理
  // ══════════════════════════════════════════════════════════════

  async addTag(id: string, tag: string): Promise<void> {
    this.sqlite.addTag(id, tag)
    // 标签变更不影响向量
    this.logger.info(`标签添加成功: ${id} +${tag}`)
  }

  async removeTag(id: string, tag: string): Promise<void> {
    this.sqlite.removeTag(id, tag)
    this.logger.info(`标签移除成功: ${id} -${tag}`)
  }

  // ══════════════════════════════════════════════════════════════
  // V23: 共享 LTM 方法
  // ══════════════════════════════════════════════════════════════

  /**
   * V23: 加载玩家事实（player_fact 类型），按 key 去重取 importance 最高的一条
   * @param keys 可选，只查询指定 key 列表
   */
  async loadPlayerFacts(
    workspaceId: string,
    opts: { keys?: string[]; limit?: number } = {},
  ): Promise<Memory[]> {
    const result = this.sqlite.query({
      type: 'player_fact' as any,
      workspaceId,
      limit: opts.limit ?? 100,
    });

    // 按 content.key 去重，保留 importance 最高的一条
    const dedup = new Map<string, Memory>();
    for (const mem of result.memories) {
      const key = String(mem.content.key ?? '');
      if (!key) continue;
      if (opts.keys && !opts.keys.includes(key)) continue;
      const existing = dedup.get(key);
      if (!existing || mem.importance > existing.importance) {
        dedup.set(key, mem);
      }
    }
    return Array.from(dedup.values());
  }

  /**
   * V23: 加载 peer 记忆（按 type 过滤、按 importance 排序）
   * 排除特定 agent 的记忆（通过 tags 中的 agent:xxx 过滤）
   */
  async loadPeerMemories(
    workspaceId: string,
    excludeAgentId: string,
    opts: { types?: string[]; minImportance?: number; limit?: number } = {},
  ): Promise<Memory[]> {
    const result = this.sqlite.query({
      type: (opts.types && opts.types.length > 0) ? opts.types[0] as any : undefined,
      workspaceId,
      minImportance: opts.minImportance,
      limit: opts.limit ?? 50,
    });

    // 过滤：排除指定 agent 的记忆（通过 tags 判断）
    const excludeTag = `agent:${excludeAgentId}`;
    return result.memories.filter(m => !m.tags.includes(excludeTag));
  }

  // ══════════════════════════════════════════════════════════════
  // 统计
  // ══════════════════════════════════════════════════════════════

  async stats(workspaceId?: string): Promise<MemoryStats> {
    return this.sqlite.stats(workspaceId)
  }

  // ══════════════════════════════════════════════════════════════
  // 清理
  // ══════════════════════════════════════════════════════════════

  async cleanup(options?: CleanupOptions): Promise<CleanupResult> {
    const mode = options?.mode ?? 'all'
    const importanceThreshold = options?.importanceThreshold ?? 2
    const keepRecent = options?.keepRecent ?? 100
    const details: CleanupDetail[] = []

    const now = Date.now()

    // 1. 过期清理
    if (mode === 'expired' || mode === 'all') {
      const expiredIds = this.sqlite.query({
        orderBy: 'created_at',
        orderDir: 'asc',
        limit: 10000,
      }).memories
        .filter(m => m.expiresAt !== null && m.expiresAt <= now)
        .map(m => m.id)

      for (const id of expiredIds) {
        await this.forget(id)
        details.push({ id, reason: 'expired' })
      }
    }

    // 2. 低重要度清理
    if (mode === 'low_importance' || mode === 'all') {
      const lowImpIds = this.sqlite.query({
        minImportance: 1,
        orderBy: 'importance',
        orderDir: 'asc',
        limit: 10000,
      }).memories
        .filter(m => m.importance <= importanceThreshold && m.accessCount === 0 && m.createdAt < now - 30 * 86400000)
        .slice(0, -keepRecent) // 保留最近 N 条
        .map(m => m.id)

      for (const id of lowImpIds) {
        await this.forget(id)
        details.push({ id, reason: 'low_importance' })
      }
    }

    // 3. 数量上限控制
    if (mode === 'all') {
      const limits = this.config.limits
      if (limits) {
        // 按类型检查
        const allTypes: MemoryType[] = ['player_habit', 'map_point', 'task_experience', 'social', 'skill']
        for (const type of allTypes) {
          const typeMems = this.sqlite.query({
            type,
            orderBy: 'created_at',
            orderDir: 'desc',
            limit: 10000,
          })

          if (typeMems.total > limits.maxPerType) {
            const toRemove = typeMems.memories.slice(limits.maxPerType)
            for (const m of toRemove) {
              await this.forget(m.id)
              details.push({ id: m.id, reason: `type_${type}_limit` })
            }
          }
        }

        // 总数量检查
        const totalStats = this.sqlite.stats()
        if (totalStats.total > limits.maxTotal) {
          const allMems = this.sqlite.query({
            orderBy: 'importance',
            orderDir: 'asc',
            limit: 10000,
          })
          const excess = allMems.memories.slice(limits.maxTotal)
          for (const m of excess) {
            await this.forget(m.id)
            details.push({ id: m.id, reason: 'total_limit' })
          }
        }
      }
    }

    this.logger.info(`清理完成: ${details.length} 条被删除`)
    return {
      removed: details.length,
      kept: 0, // 调用方可通过 stats 获取最新数量
      details,
    }
  }

  // ══════════════════════════════════════════════════════════════
  // 导出/导入
  // ══════════════════════════════════════════════════════════════

  async export(options?: ExportOptions): Promise<string> {
    const memories = this.sqlite.query({
      type: options?.type,
      limit: 10000,
    }).memories

    // 如果指定了 IDs，过滤
    const filtered = options?.ids
      ? memories.filter(m => options.ids!.includes(m.id))
      : memories

    const data = filtered.map(m => ({
      id: m.id,
      workspaceId: m.workspaceId,
      type: m.type,
      branch: m.branch,
      content: m.content,
      tags: m.tags,
      importance: m.importance,
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
      expiresAt: m.expiresAt,
    }))

    if (options?.format === 'jsonl') {
      return data.map(d => JSON.stringify(d)).join('\n')
    }

    return JSON.stringify(data, null, 2)
  }

  async import(json: string): Promise<ImportResult> {
    const errors: Array<{ index: number; reason: string }> = []
    let imported = 0
    let skipped = 0

    let records: Array<Record<string, unknown>>
    try {
      // 尝试 JSON 数组
      records = JSON.parse(json) as Array<Record<string, unknown>>
      if (!Array.isArray(records)) {
        throw new Error('Not an array')
      }
    } catch {
      // 尝试 JSONL（按行解析）
      const lines = json.split('\n').filter(line => line.trim().length > 0)
      if (lines.length === 0) {
        return { imported: 0, skipped: 0, errors: [{ index: 0, reason: '无法解析 JSON 格式' }] }
      }
      records = []
      for (let i = 0; i < lines.length; i++) {
        try {
          records.push(JSON.parse(lines[i]) as Record<string, unknown>)
        } catch {
          skipped++
          errors.push({ index: i, reason: '行 JSON 解析失败' })
        }
      }
    }

    for (let i = 0; i < records.length; i++) {
      try {
        const record = records[i]
        if (!record.type || !record.content) {
          skipped++
          errors.push({ index: i, reason: '缺少 type 或 content 字段' })
          continue
        }

        const memory: Memory = {
          id: (record.id as string) ?? randomUUID(),
          workspaceId: (record.workspaceId as string) ?? 'default',
          type: record.type as MemoryType,
          branch: (record.branch as MemoryBranch) ?? 'experience',
          content: record.content as Record<string, unknown>,
          tags: (record.tags as string[]) ?? [],
          importance: (record.importance as number) ?? 5,
          accessCount: 0,
          embeddingId: null,
          createdAt: (record.createdAt as number) ?? Date.now(),
          updatedAt: (record.updatedAt as number) ?? Date.now(),
          expiresAt: (record.expiresAt as number | null) ?? null,
        }

        this.sqlite.saveMeta(memory)
        await this.tryEmbed(memory)
        imported++
      } catch (err) {
        skipped++
        errors.push({ index: i, reason: `导入失败: ${(err as Error).message}` })
      }
    }

    this.logger.info(`导入完成: ${imported} 条成功, ${skipped} 条跳过`)
    return { imported, skipped, errors }
  }

  // ══════════════════════════════════════════════════════════════
  // 生命周期
  // ══════════════════════════════════════════════════════════════

  async close(): Promise<void> {
    this.sqlite.close()
    await this.chroma.close()
  }
}