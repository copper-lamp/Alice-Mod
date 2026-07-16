/**
 * V22 §5.7 MemoryCompressor — 分层记忆压缩
 *
 * 按"时间 + 重要性"压缩 ProgressState 与任意文本，控制上下文 token 消耗。
 *
 * 默认 5 档（DEFAULT_TIERS）：
 *   T0 当天不压缩 / T1 1-3 天普通 200 / T2 1-3 天关键 400
 *   T3 ≥3 天普通 100 / T4 ≥3 天关键 200
 *
 * 档位按 minAgeDays 升序匹配，第一个 ageDays ≥ minAgeDays 的档位生效；
 * 同一时间窗口内 critical 与 normal 是两个独立档位。
 */

import type { CompressionTier, ProgressState } from './types'

// ════════════════════════════════════════════════════════════════
// 默认档位（§5.7）
// ════════════════════════════════════════════════════════════════

export const DEFAULT_TIERS: CompressionTier[] = [
  { minAgeDays: 0, importance: 'normal', maxTokens: Number.POSITIVE_INFINITY }, // T0 当天不压缩
  { minAgeDays: 1, importance: 'normal', maxTokens: 200 }, // T1 1-3 天普通
  { minAgeDays: 1, importance: 'critical', maxTokens: 400 }, // T2 1-3 天关键
  { minAgeDays: 3, importance: 'normal', maxTokens: 100 }, // T3 ≥3 天普通
  { minAgeDays: 3, importance: 'critical', maxTokens: 200 }, // T4 ≥3 天关键
]

/** 关键事实关键词（降级自动识别用，§5.7） */
const CRITICAL_KEYWORDS = /(约定|规则|账号|密码|密钥|位置|坐标|基|基地|家|home|key|secret|token)/i

/** 自动识别文本是否为关键事实 */
export function detectCritical(text: string): boolean {
  return CRITICAL_KEYWORDS.test(text)
}

// ════════════════════════════════════════════════════════════════
// 依赖
// ════════════════════════════════════════════════════════════════

export interface MemoryCompressorDeps {
  /** 压缩档位；缺省 DEFAULT_TIERS */
  tiers?: CompressionTier[]
  /** 估算 token 数的策略；默认按字符数 / 4 估算 */
  estimateTokens?: (text: string) => number
}

// ════════════════════════════════════════════════════════════════
// MemoryCompressor 类
// ════════════════════════════════════════════════════════════════

export class MemoryCompressor {
  private readonly tiers: CompressionTier[]
  private readonly estimate: (text: string) => number

  constructor(deps: MemoryCompressorDeps = {}) {
    this.tiers = deps.tiers && deps.tiers.length > 0 ? deps.tiers : DEFAULT_TIERS
    this.estimate = deps.estimateTokens ?? defaultEstimateTokens
  }

  /**
   * 压缩 ProgressState：
   * 按已完成待办的"年龄 + critical 标记"逐条压缩，
   * 超出档位配额则截断描述/结果，最后更新 lastCompressedAt。
   */
  compressProgress(state: ProgressState): { state: ProgressState; compressed: boolean } {
    const now = Date.now()
    let anyCompressed = false

    // progress 项无 createdAt 字段，按当前窗口处理：仅依据 critical 标记选配额。
    // 后续如需年龄衰减，可在 ProgressState.completed 项中补充时间戳字段。
    const completed = state.completed.map(item => {
      const critical = detectCritical(`${item.description} ${item.result ?? ''}`)
      const tier = this.resolveTier(0, critical)
      const fullText = renderProgressItem(item)
      const tokens = this.estimate(fullText)
      if (tokens <= tier.maxTokens) {
        return item
      }
      anyCompressed = true
      // 截断到配额内：按比例裁剪描述
      const ratio = tier.maxTokens / Math.max(1, tokens)
      const keep = Math.max(20, Math.floor(item.description.length * ratio))
      return {
        ...item,
        description: item.description.slice(0, keep),
        result: item.result ? item.result.slice(0, 40) : undefined,
        tokenCount: tokens,
      }
    })

    if (!anyCompressed) {
      return { state, compressed: false }
    }
    return {
      state: { ...state, completed, lastCompressedAt: now },
      compressed: true,
    }
  }

  /**
   * 压缩任意文本（按重要性 + 年龄档位）。
   * 超出档位配额时从尾部截断并附 "…"。
   */
  compressText(text: string, opts: { ageDays: number; critical: boolean }): string {
    const tier = this.resolveTier(opts.ageDays, opts.critical)
    if (!Number.isFinite(tier.maxTokens)) return text
    const tokens = this.estimate(text)
    if (tokens <= tier.maxTokens) return text
    // 按比例截断（token 估算与字符数线性相关）
    const keepChars = Math.max(20, Math.floor(text.length * (tier.maxTokens / Math.max(1, tokens))))
    return text.slice(0, keepChars) + '…'
  }

  /**
   * 查找当前 (ageDays, importance) 对应的档位。
   * 按 tiers 顺序取第一个 ageDays ≥ minAgeDays 且 importance 匹配的档位。
   * 若无精确 importance 匹配，回退到同 minAgeDays 的 normal 档。
   */
  resolveTier(ageDays: number, critical: boolean): CompressionTier {
    const importance: CompressionTier['importance'] = critical ? 'critical' : 'normal'
    // 第一轮：精确匹配 importance
    for (const tier of this.tiers) {
      if (tier.importance === importance && ageDays >= tier.minAgeDays) {
        return tier
      }
    }
    // 第二轮：回退到 normal
    for (const tier of this.tiers) {
      if (ageDays >= tier.minAgeDays) {
        return tier
      }
    }
    // 兜底：最后一个档位
    return this.tiers[this.tiers.length - 1]
  }

  /** 估算文本 token 数（默认字符数 / 4） */
  estimateTokens(text: string): number {
    return this.estimate(text)
  }
}

// ════════════════════════════════════════════════════════════════
// 辅助
// ════════════════════════════════════════════════════════════════

/** 默认 token 估算：字符数 / 4 */
function defaultEstimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/** 渲染单个 progress 项为可估算的文本 */
function renderProgressItem(item: ProgressState['completed'][number]): string {
  return `${item.description}${item.result ?? ''}${item.failureReason ?? ''}`
}
