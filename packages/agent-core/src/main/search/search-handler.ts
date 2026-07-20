/**
 * search-handler — 搜索 IPC 处理器
 */

import { ipcMain } from 'electron'
import { SearchClient } from './search-client'

let searchClient: SearchClient | null = null

export function setSearchClient(client: SearchClient): void {
  searchClient = client
}

/** 获取搜索客户端实例（供 pipeline 中间件本地调用） */
export function getSearchClient(): SearchClient | null {
  return searchClient
}

export function registerSearchHandlers(): void {
  ipcMain.handle('search:web', async (_event, params: { query: string; limit?: number }) => {
    if (!searchClient) return { results: [], total: 0, query: params.query }
    try {
      return await searchClient.search(params.query, params.limit ?? 8)
    } catch (err) {
      console.error('[SearchHandler] search error:', err)
      return { results: [], total: 0, query: params.query }
    }
  })

  ipcMain.handle('search:fetch', async (_event, params: { url: string }) => {
    if (!searchClient) return null
    try {
      return await searchClient.fetchPage(params.url)
    } catch (err) {
      console.error('[SearchHandler] fetch error:', err)
      return null
    }
  })
}
