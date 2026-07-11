/**
 * memory-handler — 记忆系统 IPC 处理器
 *
 * 为渲染进程（记忆浏览器 UI）提供记忆 CRUD 操作。
 * 通过全局 MemoryManager 实例访问记忆系统。
 */

import { ipcMain } from 'electron'
import type { MemoryManager } from '../memory/memory-manager'

let memoryManager: MemoryManager | null = null

/** 设置 MemoryManager 实例（在应用初始化时调用） */
export function setMemoryManager(manager: MemoryManager): void {
  memoryManager = manager
}

export function registerMemoryHandlers(): void {
  // 获取记忆列表
  ipcMain.handle('memory:list', async (_event, params: {
    type?: string
    tags?: string[]
    keywords?: string
    limit?: number
    offset?: number
  }) => {
    if (!memoryManager) {
      return { memories: [], total: 0, limit: 20, offset: 0 }
    }
    try {
      const result = await memoryManager.list({
        type: params.type as any,
        tags: params.tags,
        keywords: params.keywords ? [params.keywords] : undefined,
        limit: params.limit ?? 20,
        offset: params.offset ?? 0,
      })
      return result
    } catch (err) {
      console.error('[MemoryHandler] list error:', err)
      return { memories: [], total: 0, limit: params.limit ?? 20, offset: params.offset ?? 0 }
    }
  })

  // 获取单条记忆详情
  ipcMain.handle('memory:getById', async (_event, { id }: { id: string }) => {
    if (!memoryManager) return null
    try {
      return await memoryManager.getById(id)
    } catch (err) {
      console.error('[MemoryHandler] getById error:', err)
      return null
    }
  })

  // 更新记忆
  ipcMain.handle('memory:update', async (_event, { id, updates }: { id: string; updates: Record<string, unknown> }) => {
    if (!memoryManager) return { success: false, error: 'MemoryManager 未初始化' }
    try {
      await memoryManager.update(id, updates as any)
      return { success: true }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  // 删除记忆
  ipcMain.handle('memory:forget', async (_event, { id }: { id: string }) => {
    if (!memoryManager) return { success: false, error: 'MemoryManager 未初始化' }
    try {
      await memoryManager.forget(id)
      return { success: true }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  // 语义搜索记忆
  ipcMain.handle('memory:similar', async (_event, { query, type, limit }: {
    query: string
    type?: string
    limit?: number
  }) => {
    if (!memoryManager) return { memories: [] }
    try {
      const result = await memoryManager.getSimilar({
        query,
        type: type as any,
        limit: limit ?? 10,
      })
      return result
    } catch (err) {
      console.error('[MemoryHandler] similar error:', err)
      return { memories: [] }
    }
  })
}