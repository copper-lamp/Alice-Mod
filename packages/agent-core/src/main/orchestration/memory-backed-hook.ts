/**
 * V22 §5.9 MemoryBackedLongTermMemoryHook — 把 TaskMemory 推送到 V11/V12 记忆系统
 *
 * 把 Orchestrator 收尾阶段的 TaskMemory 转换为 V11 记忆条目，桥接 task_experience 分支。
 * 失败不影响 TaskMemory 落库（Orchestrator 已在外层 try/catch 保护）。
 *
 * 转换规则：
 *   outcome=success/partial    → importance 5-6，branch=task_archive
 *   outcome=failed             → importance 7，  branch=experience（教训）
 *   outcome=aborted            → importance 3，  branch=task_archive
 *   keyOutcomes[i]             → 逐条记为子记忆，importance=4，tag=plan_id
 */

import type { TaskMemory } from './types'
import type { LongTermMemoryHook } from './long-term-memory-hook'
import type { MemoryManager, StoreParams, MemoryBranch } from '../memory'

/** 长期记忆桥接器配置 */
export interface MemoryBackedHookConfig {
  /** 是否同时写 keyOutcomes 子条目（默认 true） */
  writeKeyOutcomes?: boolean
  /** 单个 plan 子条目的最大数量（默认 5，与 buildTaskMemory 截断一致） */
  maxKeyOutcomes?: number
  /** 失败时是否抛错（默认 false — Orchestrator 已有 try/catch 兜底） */
  rethrow?: boolean
}

export class MemoryBackedLongTermMemoryHook implements LongTermMemoryHook {
  private readonly memory: MemoryManager
  private readonly config: Required<MemoryBackedHookConfig>

  constructor(memory: MemoryManager, config: MemoryBackedHookConfig = {}) {
    this.memory = memory
    this.config = {
      writeKeyOutcomes: config.writeKeyOutcomes ?? true,
      maxKeyOutcomes: config.maxKeyOutcomes ?? 5,
      rethrow: config.rethrow ?? false,
    }
  }

  async commit(workspaceId: string, taskMemory: TaskMemory): Promise<void> {
    try {
      // 1. 主条目：plan 整体结果
      const { branch, importance, tags } = this.classifyOutcome(taskMemory)
      const mainContent = {
        planId: taskMemory.planId,
        goal: taskMemory.goal,
        outcome: taskMemory.outcome,
        keyOutcomes: taskMemory.keyOutcomes,
        failureReasons: taskMemory.failureReasons ?? null,
        artifacts: taskMemory.artifacts ?? null,
        durationMs: taskMemory.durationMs,
        totalTokens: taskMemory.totalTokens,
        committedAt: taskMemory.committedAt,
      }

      await this.memory.store(
        {
          type: 'task_experience',
          branch,
          content: mainContent,
          tags,
          importance,
        },
        workspaceId,
      )

      // 2. 子条目：keyOutcomes 逐条拆开（方便 recall 命中）
      if (this.config.writeKeyOutcomes && taskMemory.keyOutcomes.length > 0) {
        const limit = Math.min(taskMemory.keyOutcomes.length, this.config.maxKeyOutcomes)
        await this.memory.batchStore(
          {
            items: Array.from({ length: limit }, (_, i) => ({
              type: 'task_experience' as const,
              branch: 'task_archive' as MemoryBranch,
              content: {
                planId: taskMemory.planId,
                goal: taskMemory.goal,
                outcomeText: taskMemory.keyOutcomes[i],
                outcomeIndex: i,
              },
              tags: [...tags, 'key_outcome'],
              importance: 4,
            })),
          },
          workspaceId,
        )
      }
    } catch (err) {
      // 桥接器失败不影响 task memory 落库；按需向上抛
      if (this.config.rethrow) throw err
    }
  }

  /** 根据 outcome 决定分支与重要度 */
  private classifyOutcome(m: TaskMemory): {
    branch: MemoryBranch
    importance: number
    tags: string[]
  } {
    const baseTags = ['orchestration', `plan:${m.planId}`]
    switch (m.outcome) {
      case 'success':
        return { branch: 'task_archive', importance: 5, tags: [...baseTags, 'outcome:success'] }
      case 'partial':
        return { branch: 'task_archive', importance: 6, tags: [...baseTags, 'outcome:partial'] }
      case 'failed':
        return {
          branch: 'experience',
          importance: 7,
          tags: [...baseTags, 'outcome:failed', 'lesson'],
        }
      case 'aborted':
        return { branch: 'task_archive', importance: 3, tags: [...baseTags, 'outcome:aborted'] }
      default:
        return { branch: 'task_archive', importance: 5, tags: baseTags }
    }
  }
}
