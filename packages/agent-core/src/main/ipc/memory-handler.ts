/**
 * memory-handler — 记忆系统 IPC 处理器
 *
 * 为渲染进程（记忆浏览器 UI）提供记忆 CRUD 操作。
 * 通过全局 MemoryManager 实例访问记忆系统。
 *
 * v2.0 新增通道：
 *   maps:list / maps:create / maps:update / maps:delete — 地图路径点
 *   aim:list / aim:get / aim:create / aim:update / aim:delete — 目标任务
 *   knowledge:query                                     — 知识库
 */

import { ipcMain } from 'electron'
import type { MemoryManager } from '../memory/memory-manager'
import { mapsQuery } from '../memory/tools/maps_query'
import { mapsEdit } from '../memory/tools/maps_edit'
import { aimList } from '../memory/tools/aim_list'
import { aimQuery } from '../memory/tools/aim_query'
import { aimUpdate } from '../memory/tools/aim_update'
import { knowledgeQuery } from '../memory/tools/knowledge_query'
import { memoryEdit } from '../memory/tools/memory_edit'

let memoryManager: MemoryManager | null = null

/** 设置 MemoryManager 实例（在应用初始化时调用） */
export function setMemoryManager(manager: MemoryManager): void {
  memoryManager = manager
}

/** 获取当前 MemoryManager 实例 */
export function getMemoryManager(): MemoryManager | null {
  return memoryManager
}

export function registerMemoryHandlers(): void {
  // 存储单条记忆
  ipcMain.handle('memory:store', async (_event, params: {
    type: string
    branch?: string
    content: Record<string, unknown>
    tags?: string[]
    importance?: number
    workspaceId?: string
  }) => {
    if (!memoryManager) {
      return { success: false, error: 'MemoryManager 未初始化' }
    }
    try {
      const result = await memoryManager.store({
        type: params.type as any,
        branch: params.branch as any,
        content: params.content,
        tags: params.tags,
        importance: params.importance,
      }, params.workspaceId)
      return { success: true, data: result }
    } catch (err) {
      console.error('[MemoryHandler] store error:', err)
      return { success: false, error: (err as Error).message }
    }
  })

  // 获取记忆列表
  ipcMain.handle('memory:list', async (_event, params: {
    type?: string
    branch?: string
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
        branch: params.branch as any,
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

  // ════════════════════════════════════════════════════════════════
  // v2.0 记忆编辑（create/update/delete 三合一）
  // ════════════════════════════════════════════════════════════════

  ipcMain.handle('memory:edit', async (_event, params: {
    action: 'create' | 'update' | 'delete'
    id?: string
    type?: string
    name?: string
    content?: string
    tags?: string[]
    importance?: number
  }) => {
    if (!memoryManager) return { success: false, error: 'MemoryManager 未初始化' }
    try {
      const result = await memoryEdit(memoryManager, params)
      return { success: result.success, id: result.data?.id, error: result.error }
    } catch (err) {
      console.error('[MemoryHandler] memory:edit error:', err)
      return { success: false, error: (err as Error).message }
    }
  })

  // ════════════════════════════════════════════════════════════════
  // v2.0 地图路径点 IPC
  // ════════════════════════════════════════════════════════════════

  ipcMain.handle('maps:list', async (_event, params: {
    keywords?: string[]
    x?: number
    z?: number
    radius?: number
    dimension?: string
    limit?: number
  }) => {
    if (!memoryManager) return { waypoints: [], total: 0 }
    try {
      const result = await mapsQuery(memoryManager, params)
      if (result.success && result.data) {
        return result.data
      }
      return { waypoints: [], total: 0 }
    } catch (err) {
      console.error('[MemoryHandler] maps:list error:', err)
      return { waypoints: [], total: 0 }
    }
  })

  ipcMain.handle('maps:create', async (_event, params: {
    dimension: string
    x: number
    y: number
    z: number
    name: string
    description?: string
    tags?: string[]
  }) => {
    if (!memoryManager) return { error: 'MemoryManager 未初始化' }
    try {
      const result = await mapsEdit(memoryManager, { action: 'create', ...params })
      if (result.success && result.data) {
        return { id: result.data.id }
      }
      return { error: result.error ?? '创建失败' }
    } catch (err) {
      console.error('[MemoryHandler] maps:create error:', err)
      return { error: (err as Error).message }
    }
  })

  ipcMain.handle('maps:update', async (_event, params: {
    id: string
    name?: string
    description?: string
    tags?: string[]
  }) => {
    if (!memoryManager) return { success: false, error: 'MemoryManager 未初始化' }
    try {
      const result = await mapsEdit(memoryManager, { action: 'update', ...params })
      return { success: result.success, error: result.error }
    } catch (err) {
      console.error('[MemoryHandler] maps:update error:', err)
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('maps:delete', async (_event, { id }: { id: string }) => {
    if (!memoryManager) return { success: false, error: 'MemoryManager 未初始化' }
    try {
      const result = await mapsEdit(memoryManager, { action: 'delete', id })
      return { success: result.success, error: result.error }
    } catch (err) {
      console.error('[MemoryHandler] maps:delete error:', err)
      return { success: false, error: (err as Error).message }
    }
  })

  // ════════════════════════════════════════════════════════════════
  // v2.0 目标任务 IPC
  // ════════════════════════════════════════════════════════════════

  ipcMain.handle('aim:list', async (_event, params: { type?: string; status?: string }) => {
    if (!memoryManager) return { tasks: [] }
    try {
      const result = await aimList(memoryManager, params ?? {})
      if (result.success && result.data) {
        return { tasks: result.data.tasks }
      }
      return { tasks: [] }
    } catch (err) {
      console.error('[MemoryHandler] aim:list error:', err)
      return { tasks: [] }
    }
  })

  ipcMain.handle('aim:get', async (_event, { id }: { id: string }) => {
    if (!memoryManager) return { task: null }
    try {
      const result = await aimQuery(memoryManager, { id })
      if (result.success && result.data) {
        return { task: result.data.task }
      }
      return { task: null }
    } catch (err) {
      console.error('[MemoryHandler] aim:get error:', err)
      return { task: null }
    }
  })

  ipcMain.handle('aim:update', async (_event, params: { id: string; item_id: string; done: boolean }) => {
    if (!memoryManager) return { task: null, error: 'MemoryManager 未初始化' }
    try {
      const result = await aimUpdate(memoryManager, params)
      if (result.success && result.data) {
        return { task: result.data.task }
      }
      return { task: null, error: result.error }
    } catch (err) {
      console.error('[MemoryHandler] aim:update error:', err)
      return { task: null, error: (err as Error).message }
    }
  })

  // 创建目标任务
  ipcMain.handle('aim:create', async (_event, params: {
    type: string
    title: string
    description: string
    items: string[]
  }) => {
    if (!memoryManager) return { task: null, error: 'MemoryManager 未初始化' }
    try {
      const db = (memoryManager as any).sqlite?.db
      if (!db) return { task: null, error: '数据库未初始化' }

      const now = Date.now()
      const taskId = `aim_${now}_${Math.random().toString(36).slice(2, 8)}`

      db.prepare(
        'INSERT INTO aim_tasks (id, type, title, description, progress, status, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?, ?)'
      ).run(taskId, params.type, params.title, params.description, 'active', now, now)

      const insertItem = db.prepare(
        'INSERT INTO aim_items (id, task_id, content, done, sort_order, created_at) VALUES (?, ?, ?, 0, ?, ?)'
      )
      params.items.forEach((content, idx) => {
        const itemId = `${taskId}_item_${idx}`
        insertItem.run(itemId, taskId, content, idx, now)
      })

      const task = db.prepare('SELECT * FROM aim_tasks WHERE id = ?').get(taskId) as any
      const items = db.prepare('SELECT * FROM aim_items WHERE task_id = ? ORDER BY sort_order ASC').all(taskId) as any[]

      return {
        task: {
          id: task.id,
          type: task.type,
          title: task.title,
          description: task.description,
          items: items.map((i: any) => ({ id: i.id, content: i.content, done: i.done === 1 })),
          progress: 0,
          status: 'active',
          createdAt: task.created_at,
          updatedAt: task.updated_at,
        },
      }
    } catch (err) {
      console.error('[MemoryHandler] aim:create error:', err)
      return { task: null, error: (err as Error).message }
    }
  })

  // 删除目标任务
  ipcMain.handle('aim:delete', async (_event, { id }: { id: string }) => {
    if (!memoryManager) return { success: false, error: 'MemoryManager 未初始化' }
    try {
      const db = (memoryManager as any).sqlite?.db
      if (!db) return { success: false, error: '数据库未初始化' }

      db.prepare('DELETE FROM aim_items WHERE task_id = ?').run(id)
      db.prepare('DELETE FROM aim_tasks WHERE id = ?').run(id)

      return { success: true }
    } catch (err) {
      console.error('[MemoryHandler] aim:delete error:', err)
      return { success: false, error: (err as Error).message }
    }
  })

  // ════════════════════════════════════════════════════════════════
  // v2.0 知识库 IPC
  // ════════════════════════════════════════════════════════════════

  ipcMain.handle('knowledge:query', async (_event, params: { query: string; limit?: number }) => {
    if (!memoryManager) return { results: [] }
    try {
      const result = await knowledgeQuery(memoryManager, params)
      if (result.success && result.data) {
        return { results: result.data.results }
      }
      return { results: [] }
    } catch (err) {
      console.error('[MemoryHandler] knowledge:query error:', err)
      return { results: [] }
    }
  })
}