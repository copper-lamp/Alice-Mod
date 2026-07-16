/**
 * task_create — 任务创建工具（单条 + 批量合一）
 *
 * v2.0：items 不传时按单条模式，传时按批量模式。
 */

import type { ToolSchema, ToolResult } from '@mcagent/shared'
import { ToolCategory } from '@mcagent/shared'
import type { TaskManager } from '../task-manager'

export const TASK_CREATE_TOOL: ToolSchema = {
  name: 'task_create',
  description: '创建任务。不传 items 时按单条模式创建；传 items 时按批量模式创建多条任务',
  category: ToolCategory.Task,
  parameters: {
    // ── 单条模式 ──
    name: { type: 'string', description: '任务名称（单条模式必填）', required: false },
    type: {
      type: 'string', description: '任务类型（单条模式必填）',
      enum: ['simple', 'composite', 'loop', 'conditional'], required: false,
    },
    description: { type: 'string', description: '任务描述', required: false },
    action: { type: 'object', description: '简单/循环/条件任务的工具调用 { toolName, parameters }', required: false },
    subtask_ids: { type: 'array', description: '复合任务的子任务 ID 列表', required: false },
    loop_config: { type: 'object', description: '循环任务配置 { mode, count?, interval?, condition?, maxIterations }', required: false },
    condition: { type: 'object', description: '条件任务配置 { type, value, description? }', required: false },
    priority: {
      type: 'string', description: '优先级（默认 normal）',
      enum: ['critical', 'high', 'normal', 'low'], required: false,
    },
    dependencies: { type: 'array', description: '依赖的任务 ID 列表', required: false },
    timeout: { type: 'number', description: '超时时间（秒，默认 300）', required: false },
    retry_config: { type: 'object', description: '重试配置 { maxRetries, retryDelay, backoffMultiplier? }', required: false },
    tags: { type: 'array', description: '标签列表', required: false },
    metadata: { type: 'object', description: '自定义元数据', required: false },
    // ── 批量模式 ──
    items: { type: 'array', description: '批量模式：任务项数组，每项含 name/type/action 等字段', required: false },
  },
}

export async function taskCreate(
  manager: TaskManager,
  params: Record<string, any>,
  workspaceId?: string,
): Promise<ToolResult<unknown>> {
  const start = Date.now()
  try {
    // 批量模式
    if (params.items && Array.isArray(params.items)) {
      const result = await manager.batchCreate({
        tasks: params.items.map((p: Record<string, any>) => ({
          workspaceId: workspaceId ?? p.workspace_id ?? 'default',
          name: p.name,
          description: p.description,
          type: p.type,
          action: p.action,
          subtaskIds: p.subtask_ids,
          loopConfig: p.loop_config,
          condition: p.condition,
          priority: p.priority,
          dependencies: p.dependencies,
          timeout: p.timeout,
          retryConfig: p.retry_config,
          tags: p.tags,
          metadata: p.metadata,
        })),
      })
      return { success: true, data: result, duration: Date.now() - start }
    }

    // 单条模式
    if (!params.name || !params.type) {
      return {
        success: false,
        error: '单条模式需要 name 和 type 参数（或使用 items 数组进行批量创建）',
        duration: Date.now() - start,
      }
    }

    const result = await manager.create({
      workspaceId: workspaceId ?? 'default',
      name: params.name,
      description: params.description,
      type: params.type,
      action: params.action,
      subtaskIds: params.subtask_ids,
      loopConfig: params.loop_config,
      condition: params.condition,
      priority: params.priority,
      dependencies: params.dependencies,
      timeout: params.timeout,
      retryConfig: params.retry_config,
      tags: params.tags,
      metadata: params.metadata,
    })
    return { success: true, data: result, duration: Date.now() - start }
  } catch (err) {
    return { success: false, error: `任务创建失败: ${(err as Error).message}`, duration: Date.now() - start }
  }
}
