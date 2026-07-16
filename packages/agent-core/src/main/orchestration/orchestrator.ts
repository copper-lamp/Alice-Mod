/**
 * V22 §5.1 Orchestrator — 顶层元编排器
 *
 * 包装而非替换 V20 的 MainAgent.handle。MainAgentRegistry 在获取 MainAgent 时
 * 同步创建 Orchestrator，二者 1:1 绑定。
 *
 * 关键约束：Orchestrator 不 import MainAgent 类型，而是通过结构化接口引用 handle 方法。
 *
 * dispatch 流程（§5.1）：
 *   1. 模式判断（已有 planId / trigger complex / LLM 升级标记 → complex）
 *   2. 复杂模式：加载 plan + progress + skill
 *   3. 包装 prompt（注入 progress + skill 文本）
 *   4. 调 mainAgent.handle
 *   5. 解析 update_plan tool_calls（plan 已在 pipeline 中被 UpdatePlanHandler 修改）
 *   6. 复杂模式收尾：reconcile progress + 若 isAllDone 则生成 task memory
 */

import type { MainAgentEvent, MainAgentResult } from '../agent/main-agent'
import type { PlanManager } from './plan-manager'
import type { ProgressStateManager } from './progress-state-manager'
import type { SkillInjector } from './skill-injector'
import type { MemoryCompressor } from './memory-compressor'
import type { TaskMemoryStore } from './task-memory-store'
import type { LongTermMemoryHook } from './long-term-memory-hook'
import type { ExecutionPlan, ProgressState, SkillPhase, TaskMemory, TaskSummary } from './types'

// ════════════════════════════════════════════════════════════════
// 依赖
// ════════════════════════════════════════════════════════════════

/**
 * MainAgent 的结构化引用（仅引用 handle 方法，避免硬依赖 MainAgent 类型）。
 */
export interface MainAgentHandle {
  handle(event: MainAgentEvent): Promise<MainAgentResult>
  abort?(): void
}

export interface OrchestratorDeps {
  /** 包装的 MainAgent（仅引用 handle 方法） */
  mainAgent: MainAgentHandle
  planManager: PlanManager
  progressStateManager: ProgressStateManager
  skillInjector: SkillInjector
  memoryCompressor: MemoryCompressor
  taskMemoryStore: TaskMemoryStore
  /** V11/V12 推送钩子，可选 */
  longTermMemoryHook?: LongTermMemoryHook
  /** ProgressState 渲染 token 上限，默认 200 */
  maxProgressTokens?: number
}

/** Orchestrator 输出 */
export interface OrchestratorResult extends MainAgentResult {
  /** 关联的 plan id（无 plan 时为 undefined） */
  planId?: string
  /** 复杂模式完成时附带的 task memory id */
  taskMemoryId?: string
}

// ════════════════════════════════════════════════════════════════
// Orchestrator 类
// ════════════════════════════════════════════════════════════════

const COMPLEX_MARKER = '===COMPLEX==='

export class Orchestrator {
  private readonly deps: OrchestratorDeps
  private readonly taskMemoryStore: TaskMemoryStore
  private currentPlan: ExecutionPlan | undefined
  private readonly maxProgressTokens: number

  constructor(deps: OrchestratorDeps) {
    this.deps = deps
    this.taskMemoryStore = deps.taskMemoryStore
    this.maxProgressTokens = deps.maxProgressTokens ?? 200
  }

  // ── 公共 API ──────────────────────────────────────────────────

  /** 主入口：包装 mainAgent.handle */
  async dispatch(event: MainAgentEvent): Promise<OrchestratorResult> {
    // 1. 模式判断 + plan 获取
    const eventId = event.metadata?.eventId as string | undefined
    const existing = eventId ? this.deps.planManager.getByEvent(eventId) : undefined
    const plan = existing ?? this.currentPlan
    let isComplex = this.detectComplexMode(plan, event)

    // 2. 复杂模式：装配上下文
    let wrappedPrompt = event.prompt
    let progress: ProgressState | undefined
    if (isComplex && plan) {
      progress = this.deps.progressStateManager.load(plan.id)
      const compressed = this.deps.memoryCompressor.compressProgress(progress)
      if (compressed.compressed) {
        // 压缩后状态已更新（load 缓存下次会用新值）
        progress = compressed.state
      }
      const phase = this.inferPhase(plan, progress)
      const skill = this.deps.skillInjector.pick(phase)
      const skillText = this.deps.skillInjector.render(skill)
      const progressText = this.deps.progressStateManager.renderForPrompt(progress)
      wrappedPrompt = this.renderExecutionContext(event.prompt, plan, progressText, skillText)
    }

    // 3. 调底层 MainAgent
    const result = await this.deps.mainAgent.handle({ ...event, prompt: wrappedPrompt })

    // 3.1 若 LLM 在 response 中显式标记 ===COMPLEX===，强制升级为复杂模式
    if (!isComplex && result.finalResponse.includes(COMPLEX_MARKER)) {
      isComplex = true
    }

    // 4. 复杂模式收尾
    if (isComplex && plan) {
      // 4.1 若 LLM 第一轮输出了完整 plan JSON，提取落库
      if (plan.todos.length === 0) {
        try {
          const ingested = this.deps.planManager.ingestFromLLM(plan.id, result.finalResponse)
          if (ingested.todos.length >= 2) {
            isComplex = true
          }
        } catch {
          // 解析失败：保持 simple，不崩溃
        }
      }

      // 4.2 reconcile progress：对 plan 中新完成的 todo 记录回退 summary
      // （update_plan 工具已在 pipeline 内修改 plan，这里仅同步 progress）
      this.reconcileProgress(plan.id)

      // 4.3 若 plan 全部完成 → 生成 task memory
      if (this.deps.planManager.isAllDone(plan.id)) {
        const taskMemory = this.buildTaskMemory(plan, result)
        const id = await this.deps.taskMemoryStore.append(taskMemory)
        // 可选：推送到 V11/V12 长期记忆（失败不影响 task memory 落库）
        if (this.deps.longTermMemoryHook) {
          try {
            const workspaceId =
              (event.metadata?.workspaceId as string | undefined) ??
              this.taskMemoryStore.workspaceId
            await this.deps.longTermMemoryHook.commit(workspaceId, taskMemory)
          } catch {
            // 长期记忆推送失败：记 error 但不阻塞（task memory 已落 SQLite）
          }
        }
        return { ...result, planId: plan.id, taskMemoryId: id }
      }
      return { ...result, planId: plan.id }
    }

    return result
  }

  /** 强制设置 plan（外部 trigger 可在派发前预置） */
  attachPlan(plan: ExecutionPlan): void {
    this.currentPlan = plan
  }

  /** 取当前 plan（供 debug-handler 等查询） */
  getCurrentPlan(): ExecutionPlan | undefined {
    return this.currentPlan
  }

  /** 中止当前 dispatch（透传给 MainAgent） */
  abort(): void {
    this.deps.mainAgent.abort?.()
  }

  // ── 内部辅助 ──────────────────────────────────────────────────

  /** 模式判断（§3.3） */
  private detectComplexMode(plan: ExecutionPlan | undefined, event: MainAgentEvent): boolean {
    if (plan && plan.todos.length >= 2) return true
    if (event.metadata?.complex === true) return true
    if (event.metadata?.planId) return true
    if (plan && plan.todos.length > 0) return true
    return false
  }

  /** 推断当前技能阶段 */
  private inferPhase(plan: ExecutionPlan, progress: ProgressState | undefined): SkillPhase {
    if (this.deps.planManager.isAllDone(plan.id)) return 'summarize'
    if (plan.todos.length === 0) return 'plan'
    if (progress?.inProgress) return 'execute'
    // 有 todos 但无 in_progress：仍按 execute（LLM 自行推进）
    return 'execute'
  }

  /** 包装 prompt：注入 plan / progress / skill 上下文 */
  private renderExecutionContext(
    originalPrompt: string,
    plan: ExecutionPlan,
    progressText: string,
    skillText: string,
  ): string {
    const sections: string[] = []
    sections.push(`# 当前任务计划 (${plan.id})`)
    sections.push(`目标：${plan.goal || '(待 LLM 填充)'}`)
    if (plan.constraints.length > 0) {
      sections.push(`约束：\n- ${plan.constraints.join('\n- ')}`)
    }
    if (plan.todos.length > 0) {
      const todoLines = plan.todos.map(t => `- [${t.status}] ${t.id}: ${t.description}`)
      sections.push(`待办：\n${todoLines.join('\n')}`)
    }
    if (progressText) {
      sections.push(`# 任务进展\n${progressText}`)
    }
    if (skillText) {
      sections.push(`# 当前阶段技能\n${skillText}`)
    }
    sections.push(`# 用户输入\n${originalPrompt}`)
    return sections.join('\n\n')
  }

  /** 同步 progress：对 plan 中已终态但 progress 未记录的 todo 记录回退 summary */
  private reconcileProgress(planId: string): void {
    const plan = this.deps.planManager.get(planId)
    if (!plan) return
    const progress = this.deps.progressStateManager.load(planId)
    const recordedIds = new Set(progress.completed.map(c => c.todoId))
    for (const todo of plan.todos) {
      if (recordedIds.has(todo.id)) continue
      if (todo.status === 'completed' || todo.status === 'failed' || todo.status === 'skipped') {
        const summary: TaskSummary = {
          todoId: todo.id,
          status: todo.status,
          result: undefined,
          failureReason: todo.failureReason,
          critical: false,
        }
        this.deps.progressStateManager.recordSummary(planId, todo.id, summary)
      }
    }
  }

  /** 构建 TaskMemory */
  private buildTaskMemory(plan: ExecutionPlan, result: MainAgentResult): TaskMemory {
    const allTodos = plan.todos
    const failedTodos = allTodos.filter(t => t.status === 'failed')
    const completedTodos = allTodos.filter(t => t.status === 'completed')
    const skippedTodos = allTodos.filter(t => t.status === 'skipped')

    let outcome: TaskMemory['outcome'] = 'success'
    if (failedTodos.length > 0 && completedTodos.length === 0) {
      outcome = 'failed'
    } else if (failedTodos.length > 0 || skippedTodos.length > 0) {
      outcome = 'partial'
    }
    if (result.error === 'ABORTED') {
      outcome = 'aborted'
    }

    const keyOutcomes = completedTodos
      .slice(0, 5)
      .map(t => `${t.description}${t.completedAt ? '' : ''}`)
    const failureReasons = failedTodos.length > 0
      ? failedTodos.map(t => t.failureReason ?? t.description)
      : undefined

    return {
      planId: plan.id,
      goal: plan.goal,
      outcome,
      keyOutcomes,
      failureReasons,
      durationMs: result.durationMs,
      totalTokens: result.totalTokens,
      committedAt: Date.now(),
    }
  }
}
