/**
 * V22 §5.3 ProgressStateManager — 进展状态管理
 *
 * 维护 plan 维度的进展状态、自动汇总 todo 完成摘要、控制 token 上限（默认 200）。
 *
 * ProgressState 是 LLM 下一轮 context 的关键组成，严格 ≤ maxTokens（默认 200）。
 * 内容来源由 Agent Core 在每次 todo 状态变更后自动生成，不消耗 LLM 调用。
 */

import type { PlanManager } from './plan-manager'
import type { MemoryCompressor } from './memory-compressor'
import type { ProgressState, TaskSummary } from './types'

// ════════════════════════════════════════════════════════════════
// 依赖
// ════════════════════════════════════════════════════════════════

export interface ProgressStateManagerDeps {
  planManager: PlanManager
  compressor: MemoryCompressor
  /** 渲染 token 上限，默认 200 */
  maxTokens?: number
}

// ════════════════════════════════════════════════════════════════
// ProgressStateManager 类
// ════════════════════════════════════════════════════════════════

export class ProgressStateManager {
  private readonly planManager: PlanManager
  private readonly compressor: MemoryCompressor
  private readonly maxTokens: number
  /** planId → ProgressState（内存缓存，跨轮持久） */
  private readonly cache = new Map<string, ProgressState>()

  constructor(deps: ProgressStateManagerDeps) {
    this.planManager = deps.planManager
    this.compressor = deps.compressor
    this.maxTokens = deps.maxTokens ?? 200
  }

  /**
   * 加载/重建 plan 的 progress state。
   * 优先用缓存；无缓存则从 plan 的 todos 重建（已完成项生成回退摘要）。
   */
  load(planId: string): ProgressState {
    const cached = this.cache.get(planId)
    if (cached) return cached
    return this.rebuildFromPlan(planId)
  }

  /**
   * todo 状态变更时调用：追加 summary 到 completed 列表（去重），
   * 更新 inProgress，最后触发压缩。
   */
  recordSummary(planId: string, todoId: string, summary: TaskSummary): ProgressState {
    const plan = this.planManager.get(planId)
    const current = this.load(planId)
    const todo = plan?.todos.find(t => t.id === todoId)

    // 去重：移除同 todoId 的旧记录
    const completed = current.completed.filter(c => c.todoId !== todoId)
    const desc = todo?.description ?? summary.todoId
    const text = `${desc} ${summary.result ?? ''} ${summary.failureReason ?? ''}`
    completed.unshift({
      todoId,
      description: desc,
      status: summary.status,
      result: summary.result,
      failureReason: summary.failureReason,
      tokenCount: this.compressor.estimateTokens(text),
    })

    // 更新 inProgress：该 todo 已进入终态（completed/failed/skipped），从 inProgress 中移除
    // 并尝试选下一个 pending 作为建议 inProgress
    let inProgress = current.inProgress
    if (inProgress?.todoId === todoId) {
      inProgress = this.pickNextInProgress(plan, todoId)
    }

    const nextState: ProgressState = {
      ...current,
      completed,
      inProgress,
      lastCompressedAt: current.lastCompressedAt,
    }
    const state = this.compressIfNeeded(nextState)
    this.cache.set(planId, state)
    return state
  }

  /** 主动压缩 */
  compress(planId: string): ProgressState {
    const current = this.load(planId)
    const state = this.compressIfNeeded(current)
    this.cache.set(planId, state)
    return state
  }

  /**
   * 渲染为可注入 prompt 的文本（严格 ≤ maxTokens）。
   * 输出示例（§5.3）：
   *   [任务进展] 计划 plan-abc123
   *   ✅ #2 已收集 16 个圆石 (result: 16 cobblestone)
   *   🔄 #3 正在挖掘铁矿（in_progress）
   */
  renderForPrompt(state: ProgressState): string {
    const lines: string[] = [`[任务进展] 计划 ${state.planId}`]
    if (state.inProgress) {
      lines.push(`🔄 ${state.inProgress.todoId} ${state.inProgress.description}（in_progress）`)
    }
    for (const item of state.completed) {
      const icon = item.status === 'completed' ? '✅'
        : item.status === 'failed' ? '❌'
        : '⏭️'
      const tail = item.result ? ` (result: ${item.result})`
        : item.failureReason ? ` (failed: ${item.failureReason})`
        : ''
      lines.push(`${icon} ${item.todoId} ${item.description}${tail}`)
    }
    let text = lines.join('\n')
    // 严格按 maxTokens 截断
    const tokens = this.compressor.estimateTokens(text)
    if (tokens > this.maxTokens) {
      const ratio = this.maxTokens / Math.max(1, tokens)
      const keep = Math.max(40, Math.floor(text.length * ratio))
      text = text.slice(0, keep) + '…'
    }
    return text
  }

  // ── 内部辅助 ──────────────────────────────────────────────────

  /** 从 plan 状态重建 progress（LLM 未主动 record 时的回退路径） */
  private rebuildFromPlan(planId: string): ProgressState {
    const plan = this.planManager.get(planId)
    const completed: ProgressState['completed'] = []
    let inProgress: ProgressState['inProgress'] = undefined
    if (plan) {
      for (const todo of plan.todos) {
        if (todo.status === 'completed' || todo.status === 'failed' || todo.status === 'skipped') {
          const text = `${todo.description} ${todo.failureReason ?? ''}`
          completed.unshift({
            todoId: todo.id,
            description: todo.description,
            status: todo.status as 'completed' | 'failed' | 'skipped',
            failureReason: todo.failureReason,
            tokenCount: this.compressor.estimateTokens(text),
          })
        } else if (todo.status === 'in_progress' && !inProgress) {
          inProgress = { todoId: todo.id, description: todo.description }
        }
      }
    }
    const state: ProgressState = {
      planId,
      completed,
      inProgress,
      lastCompressedAt: 0,
    }
    this.cache.set(planId, state)
    return state
  }

  /** 超出 maxTokens 时触发压缩；2 次仍超则强制截断最早 1 条 */
  private compressIfNeeded(state: ProgressState): ProgressState {
    const text = this.renderRaw(state)
    const tokens = this.compressor.estimateTokens(text)
    if (tokens <= this.maxTokens) return state
    // 第一次：用 compressor 压缩
    const compressed = this.compressor.compressProgress(state)
    if (compressed.compressed) return compressed.state
    // 第二次仍超：强制截断最早 1 条
    if (state.completed.length > 1) {
      return {
        ...state,
        completed: state.completed.slice(0, -1),
        lastCompressedAt: Date.now(),
      }
    }
    return state
  }

  /** 渲染但不截断（用于 token 估算） */
  private renderRaw(state: ProgressState): string {
    const lines: string[] = [`[任务进展] 计划 ${state.planId}`]
    if (state.inProgress) {
      lines.push(`🔄 ${state.inProgress.todoId} ${state.inProgress.description}`)
    }
    for (const item of state.completed) {
      lines.push(`${item.todoId} ${item.description} ${item.result ?? ''} ${item.failureReason ?? ''}`)
    }
    return lines.join('\n')
  }

  /** 选下一个 pending todo 作为 inProgress（不强制，仅建议） */
  private pickNextInProgress(
    plan: { todos: Array<{ id: string; status: string; description: string }> } | undefined,
    excludeId: string,
  ): { todoId: string; description: string } | undefined {
    if (!plan) return undefined
    const next = plan.todos.find(t => t.id !== excludeId && t.status === 'pending')
    if (!next) return undefined
    return { todoId: next.id, description: (next as { description: string }).description }
  }
}
