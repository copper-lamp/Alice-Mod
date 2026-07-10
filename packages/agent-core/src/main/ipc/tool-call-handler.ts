/**
 * 工具调用记录查询 IPC Handler
 *
 * 提供后端调试 API 供主进程内部模块调用。
 * 纯后端模块，不接入渲染进程 UI。
 */
import { ipcMain } from 'electron'
import { PipelineEventCollector } from '../pipeline/event-collector'

let collector: PipelineEventCollector

export function setToolCallCollector(tc: PipelineEventCollector): void {
  collector = tc
}

export function getToolCallCollector(): PipelineEventCollector {
  if (!collector) {
    collector = new PipelineEventCollector()
  }
  return collector
}

export function registerToolCallHandlers(): void {
  // 获取工具调用历史
  ipcMain.handle('tool-call:history', async (_event, { workspaceId, limit = 100 }: { workspaceId: string; limit?: number }) => {
    return collector.getHistory(workspaceId, limit)
  })

  // 获取单条工具调用详情
  ipcMain.handle('tool-call:get-by-id', async (_event, { toolCallId }: { toolCallId: string }) => {
    return collector.getById(toolCallId)
  })

  // 获取工具调用统计
  ipcMain.handle('tool-call:stats', async (_event, { workspaceId }: { workspaceId: string }) => {
    return collector.getStats(workspaceId)
  })

  // 清空工具调用历史
  ipcMain.handle('tool-call:clear', async (_event, { workspaceId }: { workspaceId: string }) => {
    collector.clear(workspaceId)
    return { success: true }
  })
}