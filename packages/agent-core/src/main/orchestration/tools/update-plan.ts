/**
 * V22 §5.5 update_plan 工具 — Schema + Handler
 *
 * 作为 ToolRegistry 中的一个内置工具，对所有 agent 默认启用。
 * 工具调用不消耗 LLM 轮次，与正常 tool_call 并行存在（走 BatchToolDispatcher）。
 *
 * Handler 调用 PlanManager.apply，失败时返回 success=false + reason，
 * LLM 下一轮可重试。工具失败不打断主流程。
 */

import type { ToolSchema, ToolResult } from '@mcagent/shared'
import { ToolCategory } from '@mcagent/shared'
import type { PlanManager } from '../plan-manager'
import type { UpdatePlanArgs } from '../types'

// ════════════════════════════════════════════════════════════════
// Tool Schema
// ════════════════════════════════════════════════════════════════

export const UPDATE_PLAN_TOOL: ToolSchema = {
  name: 'update_plan',
  description: '调整执行计划：新增 / 修改状态 / 拆分 / 重排 / 标记进行中 todo。',
  category: ToolCategory.Task,
  parameters: {
    operation: {
      type: 'string',
      description: '操作类型',
      required: true,
      enum: ['add', 'update_status', 'split', 'reorder', 'set_in_progress'],
    },
    todoId: {
      type: 'string',
      description: '操作目标的 todo id（add 时不需要）',
      required: false,
    },
    newTodo: {
      type: 'object',
      description: '新增的 todo（operation=add 时必填）',
      required: false,
      properties: {
        description: { type: 'string', description: '一句话描述（≤ 80 字）', required: true },
        expectedTools: {
          type: 'array',
          description: '预期使用的工具名',
          required: false,
          items: { type: 'string' },
        },
        dependsOn: {
          type: 'array',
          description: '依赖的 todo id 列表',
          required: false,
          items: { type: 'string' },
        },
      },
    },
    splitInto: {
      type: 'array',
      description: '拆分后的子 todo 列表（operation=split 时必填）',
      required: false,
      items: {
        type: 'object',
        description: '子 todo 定义',
        properties: {
          description: { type: 'string', description: '一句话描述', required: true },
          expectedTools: {
            type: 'array',
            description: '预期工具',
            required: false,
            items: { type: 'string' },
          },
        },
      },
    },
    status: {
      type: 'string',
      description: '更新后的状态（operation=update_status 时必填）',
      required: false,
      enum: ['pending', 'in_progress', 'completed', 'skipped', 'failed'],
    },
    result: {
      type: 'string',
      description: '完成时的关键结果（status=completed 时可选，≤ 40 字，节省 token）',
      required: false,
    },
    failureReason: {
      type: 'string',
      description: '失败原因（status=failed 时建议必填）',
      required: false,
    },
    newOrder: {
      type: 'array',
      description: '重排后的 todo id 顺序（operation=reorder 时必填，仅 pending 可重排）',
      required: false,
      items: { type: 'string' },
    },
  },
}

// ════════════════════════════════════════════════════════════════
// Tool Context（最小契约）
// ════════════════════════════════════════════════════════════════

/** update_plan 工具执行所需的最小上下文 */
export interface UpdatePlanContext {
  /** 当前活跃 plan id（由 Orchestrator 在派发时注入到 tool context） */
  planId?: string
}

// ════════════════════════════════════════════════════════════════
// UpdatePlanHandler
// ════════════════════════════════════════════════════════════════

export class UpdatePlanHandler {
  constructor(private readonly planManager: PlanManager) {}

  /**
   * 执行 update_plan 工具调用。
   * 失败时返回 success=false + error=reason，LLM 下一轮可重试。
   */
  execute(args: UpdatePlanArgs, context: UpdatePlanContext): ToolResult {
    const planId = context.planId
    if (!planId) {
      return { success: false, error: 'NO_ACTIVE_PLAN' }
    }
    const plan = this.planManager.get(planId)
    if (!plan) {
      return { success: false, error: `NO_ACTIVE_PLAN: ${planId}` }
    }
    const res = this.planManager.apply(plan.id, args)
    if (!res.ok) {
      return { success: false, error: res.reason ?? 'UNKNOWN' }
    }
    const updated = this.planManager.get(plan.id)
    return { success: true, data: { plan: updated } }
  }
}
