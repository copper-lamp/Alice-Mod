/**
 * V22 元编排层 — 模块聚合导出
 *
 * 导出所有公共类、接口与类型。外部模块仅从本入口导入。
 */

// ── 类型 ──────────────────────────────────────────────────────
export type {
  OrchestrationSQLiteStore,
  ExecutionPlan,
  PlanTodo,
  ProgressState,
  UpdatePlanArgs,
  TaskSummary,
  TaskMemory,
  SkillPhase,
  Skill,
  CompressionTier,
} from './types'

// ── Plan ──────────────────────────────────────────────────────
export { PlanStore } from './plan-store'
export type { PlanSaveContext } from './plan-store'
export {
  PlanManager,
  defaultPlanExtractor,
} from './plan-manager'
export type { PlanManagerDeps, ApplyResult } from './plan-manager'

// ── Progress ─────────────────────────────────────────────────
export { ProgressStateManager } from './progress-state-manager'
export type { ProgressStateManagerDeps } from './progress-state-manager'

// ── Compression ──────────────────────────────────────────────
export {
  MemoryCompressor,
  DEFAULT_TIERS,
  detectCritical,
} from './memory-compressor'
export type { MemoryCompressorDeps } from './memory-compressor'

// ── Skill ────────────────────────────────────────────────────
export { SkillInjector } from './skill-injector'
export type { SkillInjectorDeps } from './skill-injector'

// ── Task Memory ──────────────────────────────────────────────
export { TaskMemoryStore } from './task-memory-store'
export type { TaskMemoryListOpts } from './task-memory-store'

// ── Long-Term Memory Hook ────────────────────────────────────
export { NoOpLongTermMemoryHook } from './long-term-memory-hook'
export type { LongTermMemoryHook } from './long-term-memory-hook'
export { MemoryBackedLongTermMemoryHook } from './memory-backed-hook'
export type { MemoryBackedHookConfig } from './memory-backed-hook'

// ── Tools ────────────────────────────────────────────────────
export { UPDATE_PLAN_TOOL, UpdatePlanHandler } from './tools/update-plan'
export type { UpdatePlanContext } from './tools/update-plan'

// ── Orchestrator ─────────────────────────────────────────────
export { Orchestrator } from './orchestrator'
export type { OrchestratorDeps, OrchestratorResult, MainAgentHandle } from './orchestrator'
