/**
 * CleanupEngine — 自动清理引擎
 *
 * 定时执行记忆清理任务：
 * 1. 过期清理（expires_at < now）
 * 2. 低重要度清理（importance <= 2, access_count = 0, 30 天前）
 * 3. 数量上限控制（每类型超限时清理最旧记录）
 * 4. Chroma 重试嵌入（扫描 embedding_id = null 的记录）
 */

import type { MemoryManager } from './memory-manager'
import type { AutoCleanupConfig, MemoryLimits } from './types'

// ════════════════════════════════════════════════════════════════
// CleanupEngine 类
// ════════════════════════════════════════════════════════════════

export class CleanupEngine {
  private manager: MemoryManager
  private config: AutoCleanupConfig
  private limits: MemoryLimits
  private timer: ReturnType<typeof setInterval> | null = null
  private running: boolean = false
  private logger: { info: (msg: string) => void; warn: (msg: string, err?: unknown) => void; error: (msg: string, err?: unknown) => void }

  constructor(
    manager: MemoryManager,
    config: AutoCleanupConfig,
    limits: MemoryLimits,
    logger?: { info: (msg: string) => void; warn: (msg: string, err?: unknown) => void; error: (msg: string, err?: unknown) => void },
  ) {
    this.manager = manager
    this.config = config
    this.limits = limits
    this.logger = logger ?? {
      info: (msg) => console.info(`[CleanupEngine] ${msg}`),
      warn: (msg, err) => console.warn(`[CleanupEngine] ${msg}`, err),
      error: (msg, err) => console.error(`[CleanupEngine] ${msg}`, err),
    }
  }

  // ══════════════════════════════════════════════════════════════
  // 启动/停止调度
  // ══════════════════════════════════════════════════════════════

  /**
   * 启动定时清理
   */
  start(): void {
    if (this.timer) return

    const intervalMs = this.config.intervalMs ?? 86400000 // 默认 24h
    this.logger.info(`自动清理引擎已启动，间隔 ${intervalMs / 1000 / 60} 分钟`)

    this.timer = setInterval(() => {
      this.run().catch(err => {
        this.logger.error('自动清理执行失败', err)
      })
    }, intervalMs)
  }

  /**
   * 停止定时清理
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
      this.logger.info('自动清理引擎已停止')
    }
  }

  /**
   * 立即执行一次完整清理
   */
  async run(): Promise<void> {
    if (this.running) {
      this.logger.warn('清理任务正在执行中，跳过本次调度')
      return
    }

    this.running = true
    this.logger.info('开始执行自动清理...')

    try {
      // 1. 过期清理
      await this.cleanupExpired()

      // 2. 低重要度清理
      await this.cleanupLowImportance()

      // 3. 数量上限控制
      await this.cleanupLimitByType()
      await this.cleanupTotalLimit()

      // 4. Chroma 重试嵌入
      await this.retryEmbedding()
    } catch (err) {
      this.logger.error('自动清理异常', err)
    } finally {
      this.running = false
      this.logger.info('自动清理完成')
    }
  }

  // ══════════════════════════════════════════════════════════════
  // 清理规则
  // ══════════════════════════════════════════════════════════════

  /**
   * 1. 过期清理：删除 expires_at < now 的记忆
   */
  private async cleanupExpired(): Promise<void> {
    if (this.config.mode !== 'expired' && this.config.mode !== 'all') return

    const now = Date.now()
    const allMems = await this.manager.list({ limit: 10000 })
    const expired = allMems.memories.filter(m => m.expiresAt !== null && m.expiresAt <= now)

    for (const m of expired) {
      await this.manager.forget(m.id)
    }

    if (expired.length > 0) {
      this.logger.info(`过期清理: 删除 ${expired.length} 条`)
    }
  }

  /**
   * 2. 低重要度清理：importance <= 阈值, access_count = 0, 30 天前
   */
  private async cleanupLowImportance(): Promise<void> {
    if (this.config.mode !== 'low_importance' && this.config.mode !== 'all') return

    const threshold = this.config.importanceThreshold ?? 2
    const now = Date.now()
    const thirtyDaysAgo = now - 30 * 86400000

    const allMems = await this.manager.list({ limit: 10000 })
    const lowImp = allMems.memories
      .filter(m => m.importance <= threshold && m.accessCount === 0 && m.createdAt < thirtyDaysAgo)
      .slice(0, -100) // 保留最近 100 条

    for (const m of lowImp) {
      await this.manager.forget(m.id)
    }

    if (lowImp.length > 0) {
      this.logger.info(`低重要度清理: 删除 ${lowImp.length} 条(阈值=${threshold})`)
    }
  }

  /**
   * 3. 按类型数量上限清理：每类型超过 maxPerType 时清理最旧记录
   */
  private async cleanupLimitByType(): Promise<void> {
    if (this.config.mode !== 'all') return

    const maxPerType = this.limits.maxPerType ?? 1000
    const allTypes = ['player_habit', 'map_point', 'task_experience', 'social', 'skill'] as const

    for (const type of allTypes) {
      const typeMems = await this.manager.list({ type, limit: 10000, orderBy: 'created_at', orderDir: 'desc' })
      if (typeMems.total > maxPerType) {
        const toRemove = typeMems.memories.slice(maxPerType)
        for (const m of toRemove) {
          await this.manager.forget(m.id)
        }
        if (toRemove.length > 0) {
          this.logger.info(`类型上限清理(${type}): 删除 ${toRemove.length} 条(上限=${maxPerType})`)
        }
      }
    }
  }

  /**
   * 4. 总数量上限清理：超过 maxTotal 时清理最低重要度的记录
   */
  private async cleanupTotalLimit(): Promise<void> {
    if (this.config.mode !== 'all') return

    const maxTotal = this.limits.maxTotal ?? 10000
    const stats = await this.manager.stats()
    if (stats.total <= maxTotal) return

    const allMems = await this.manager.list({ limit: 10000, orderBy: 'importance', orderDir: 'asc' })
    const excess = allMems.memories.slice(maxTotal)
    for (const m of excess) {
      await this.manager.forget(m.id)
    }

    this.logger.info(`总数量上限清理: 删除 ${excess.length} 条(上限=${maxTotal})`)
  }

  /**
   * 5. Chroma 重试嵌入：扫描 embedding_id = null 的记录，重新生成向量
   */
  private async retryEmbedding(): Promise<void> {
    const unembedded = this.manager.sqlite.getUnembedded(50)

    for (const memory of unembedded) {
      try {
        const { EmbeddingStrategy } = await import('./embedding')
        const text = EmbeddingStrategy.buildEmbeddingText(memory)
        const vector = await this.manager.embedding.embed(text)
        const embeddingId = memory.id

        await this.manager.chroma.upsert(embeddingId, vector, {
          memory_id: memory.id,
          workspace_id: memory.workspaceId,
          type: memory.type,
          branch: memory.branch,
          importance: memory.importance,
          created_at: memory.createdAt,
        })

        this.manager.sqlite.markEmbedded(memory.id, embeddingId)
      } catch (err) {
        this.logger.warn(`重试嵌入失败: ${memory.id}`, err)
      }
    }

    if (unembedded.length > 0) {
      this.logger.info(`重试嵌入: ${unembedded.length} 条`)
    }
  }
}