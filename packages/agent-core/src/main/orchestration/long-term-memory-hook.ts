/**
 * V22 §5.9 LongTermMemoryHook — V11/V12 长期记忆推送钩子
 *
 * 把 TaskMemory 的关键决策与结果推送到 V11/V12 现有记忆系统。
 * 本模块只定义接口与 NoOp 默认实现；具体 V11/V12 桥接在 wiring 层提供。
 *
 * 桥接器（如 MemoryBackedLongTermMemoryHook）需要 workspaceId 来写入
 * 正确的记忆分区，因此 commit 签名把 workspaceId 作为第一个参数。
 */

import type { TaskMemory } from './types'

/**
 * 长期记忆推送钩子接口。
 * 实现方应把 keyOutcomes[] 作为 experience 写入 V11；
 * 把 artifacts 作为 map_feature 写入 V12。
 */
export interface LongTermMemoryHook {
  /** plan 完成后推送任务记忆到长期记忆系统 */
  commit(workspaceId: string, memory: TaskMemory): Promise<void>
}

/**
 * 空实现：不做任何事。
 * 在未配置 V11/V12 桥接时使用，避免上层做 null 判断。
 */
export class NoOpLongTermMemoryHook implements LongTermMemoryHook {
  async commit(_workspaceId: string, _memory: TaskMemory): Promise<void> {
    // no-op
  }
}
