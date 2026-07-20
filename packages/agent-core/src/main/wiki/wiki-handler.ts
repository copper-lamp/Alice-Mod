/**
 * wiki-handler — Wiki IPC 处理器
 *
 * 为渲染进程提供 Wiki 查询的 IPC 通道。
 * 前端通过 window.electronAPI.invoke 调用。
 */

import { ipcMain } from 'electron'
import { WikiClient } from './wiki-client'
import { renderSearchResults, renderPageSummary, renderPageContent } from './wiki-formatter'

let wikiClient: WikiClient | null = null

export function setWikiClient(client: WikiClient): void {
  wikiClient = client
}

/** 获取 Wiki 客户端实例（供 pipeline 中间件本地调用） */
export function getWikiClient(): WikiClient | null {
  return wikiClient
}

export function registerWikiHandlers(): void {
  // 搜索 Wiki
  ipcMain.handle('wiki:search', async (_event, params: { query: string; limit?: number }) => {
    if (!wikiClient) return { results: [], total: 0 }
    try {
      const result = await wikiClient.search(params.query, params.limit ?? 10)
      return result
    } catch (err) {
      console.error('[WikiHandler] search error:', err)
      return { results: [], total: 0 }
    }
  })

  // 获取页面摘要
  ipcMain.handle('wiki:get-page', async (_event, params: { title: string; mode?: 'summary' | 'full' }) => {
    if (!wikiClient) return null
    try {
      if (params.mode === 'full') {
        return await wikiClient.getPageContent(params.title)
      }
      return await wikiClient.getPageSummary(params.title)
    } catch (err) {
      console.error('[WikiHandler] getPage error:', err)
      return null
    }
  })

  // 获取章节内容
  ipcMain.handle('wiki:get-section', async (_event, params: { title: string; section_index: number }) => {
    if (!wikiClient) return null
    try {
      return await wikiClient.getSection(params.title, params.section_index)
    } catch (err) {
      console.error('[WikiHandler] getSection error:', err)
      return null
    }
  })
}
