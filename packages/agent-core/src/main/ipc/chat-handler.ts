/**
 * V28：对话历史 IPC Handler
 *
 * 提供 LLM 对话历史（chat_history 表）查询接口供前端渲染。
 * 对话流渲染组件已在 renderer 端实现（MessageList + MessageBubble）。
 */
import { ipcMain } from 'electron'
import type { ChatHistoryStore, ChatHistoryEntry } from '../chat-history'
import type { ToolCallPart } from '../prompt/types'

let historyStore: ChatHistoryStore | null = null

export function setChatHistoryStore(store: ChatHistoryStore): void {
  historyStore = store
}

/** 获取 ChatHistoryStore 实例（供其他 handler 使用） */
export function getChatHistoryStore(): ChatHistoryStore | null {
  return historyStore
}

/**
 * 将 ToolCallPart 转换为前端 ToolCallInfo 格式
 * 可选 result 参数用于填充工具调用结果
 */
function toToolCallInfo(
  tc: ToolCallPart,
  result?: { success: boolean; data?: unknown; error?: string; duration_ms?: number },
): import('../../renderer/src/lib/types').ToolCallInfo {
  // 解析 function.arguments JSON 字符串为 params 对象
  let params: Record<string, unknown> = {}
  try {
    if (tc.function?.arguments) {
      params = JSON.parse(tc.function.arguments)
    }
  } catch { /* ignore parse errors */ }

  return {
    id: tc.id,
    name: tc.function?.name ?? '',
    category: '',
    params,
    result,
    status: result ? (result.success ? 'success' : 'error') : 'success',
  }
}

/**
 * 将 ChatHistoryEntry 转换为前端 ChatMessage 格式
 */
function toChatMessage(
  entry: ChatHistoryEntry,
  resultMap?: Map<string, { success: boolean; data?: unknown; error?: string; duration_ms?: number }>,
): import('../../renderer/src/lib/types').ChatMessage {
  const toolCalls = entry.toolCalls?.map((tc) => {
    const result = resultMap?.get(tc.id)
    return toToolCallInfo(tc, result)
  })

  return {
    id: `chat_${entry.id}`,
    role: entry.role === 'tool' ? 'tool' : (entry.role as 'user' | 'assistant' | 'system'),
    content: entry.content,
    toolCalls,
    timestamp: entry.createdAt,
    workspaceId: entry.workspaceId,
    source: (entry.source === 'qq' ? 'qq' : entry.source === 'game' ? 'game' : 'system') as 'game' | 'qq' | 'system',
  }
}

/**
 * 从 entries 构建 toolCallId → result 的映射表
 * 用于将工具结果注入到对应的 ToolCallInfo 中
 */
function buildToolResultMap(entries: ChatHistoryEntry[]): Map<string, { success: boolean; data?: unknown; error?: string; duration_ms?: number }> {
  const map = new Map<string, { success: boolean; data?: unknown; error?: string; duration_ms?: number }>()
  for (const entry of entries) {
    if (entry.role === 'tool' && entry.toolCallId) {
      try {
        const parsed = JSON.parse(entry.content)
        if (typeof parsed === 'object' && parsed !== null) {
          map.set(entry.toolCallId, {
            success: parsed.success === true,
            data: parsed.data ?? parsed,
            error: parsed.error,
            duration_ms: parsed.duration_ms,
          })
        }
      } catch {
        // 非 JSON 格式，跳过
      }
    }
  }
  return map
}

export function registerChatHandlers(): void {
  // 获取 LLM 对话历史
  ipcMain.handle('chat:history', async (_event, {
    workspaceId,
    agentId,
    limit = 50,
    source,
  }: {
    workspaceId: string
    agentId?: string
    limit?: number
    source?: 'qq' | 'trigger' | 'game' | 'system'
  }) => {
    if (!historyStore || !workspaceId) return []

    try {
      // 如果没有指定 agentId，则按 workspaceId 查所有
      const entries = agentId
        ? await historyStore.load(workspaceId, agentId, { limit })
        : await historyStore.load(workspaceId, '', { limit })

      // V34: 未指定 source 时默认排除 'qq' 来源（QQ 对话有独立面板）
      const filtered = source
        ? entries.filter(e => e.source === source)
        : entries.filter(e => e.source !== 'qq')

      // 构建工具结果映射表，将 tool call 与对应的结果关联
      const resultMap = buildToolResultMap(filtered)
      return filtered.map(e => toChatMessage(e, resultMap))
    } catch (err) {
      console.error('[chat:history] 查询失败:', err)
      return []
    }
  })

  // 获取 QQ 专属的历史记录
  // V34: QQ 来源存储已迁移到 qq:${agentId} 复合键，向下兼容旧存储
  ipcMain.handle('chat:qq-history', async (_event, {
    workspaceId,
    agentId,
    limit = 50,
  }: {
    workspaceId: string
    agentId: string
    limit?: number
  }) => {
    if (!historyStore || !agentId) return []

    try {
      // 从新存储（qq:前缀）和旧存储（原 agentId）同时加载，合并去重
      const [newEntries, oldEntries] = await Promise.all([
        historyStore.load(workspaceId ?? '', `qq:${agentId}`, { limit }),
        historyStore.load(workspaceId ?? '', agentId, { limit }),
      ]);
      // 合并并按时间排序，只保留 source='qq' 的条目
      const allQqEntries = [...newEntries, ...oldEntries]
        .filter(e => e.source === 'qq')
        .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
        .slice(0, limit);
      // 去重（基于 id 或关键字段）
      const seen = new Set<number>();
      const uniqueEntries = allQqEntries.filter(e => {
        if (seen.has(e.id!)) return false;
        seen.add(e.id!);
        return true;
      });
      // 构建工具结果映射表，将 tool call 与对应的结果关联
      const resultMap = buildToolResultMap(uniqueEntries)
      return uniqueEntries.map(e => toChatMessage(e, resultMap))
    } catch (err) {
      console.error('[chat:qq-history] 查询失败:', err)
      return []
    }
  })

  // 清除指定 agent 的 QQ 对话历史
  ipcMain.handle('chat:clear-qq-history', async (_event, {
    workspaceId,
    agentId,
  }: {
    workspaceId: string
    agentId: string
  }) => {
    if (!historyStore || !agentId) return { success: false }

    try {
      // V34: 同时清除新存储（qq:前缀）和旧存储（原 agentId）
      const [deleted1, deleted2] = await Promise.all([
        historyStore.clear(workspaceId ?? '', `qq:${agentId}`),
        historyStore.clear(workspaceId ?? '', agentId),
      ]);
      const totalDeleted = deleted1 + deleted2;
      console.log(`[chat:clear-qq-history] 已清除 ${totalDeleted} 条记录 (agent=${agentId})`)
      return { success: true, deleted: totalDeleted }
    } catch (err) {
      console.error('[chat:clear-qq-history] 清除失败:', err)
      return { success: false, error: String(err) }
    }
  })
}