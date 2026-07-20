/**
 * Search 模块 — 入口
 *
 * 多引擎网页搜索模块，默认使用 Bing HTML 搜索（国内可访问，无需 API Key）。
 * 引擎优先级：Bing → 百度 → DuckDuckGo
 * 按优先级依次调用，一个引擎返回结果即停止。
 *
 * 提供 2 个工具供 LLM 调用 + 2 个 IPC 通道供前端调用。
 */

import { WEB_SEARCH_TOOL, WEB_FETCH_TOOL } from './search-tools'

export { SearchClient } from './search-client'
export type { EngineName } from './search-client'
export { setSearchClient, getSearchClient, registerSearchHandlers } from './search-handler'
export { WEB_SEARCH_TOOL, WEB_FETCH_TOOL } from './search-tools'
export { webSearch, webFetch } from './search-tools'
export { renderSearchResults, renderFetchedPage } from './search-formatter'
export type { Format } from './search-formatter'
export type { SearchResult, SearchResponse, FetchedPage } from './search-types'

/** 所有搜索工具的 Schema 列表 */
export const SEARCH_TOOL_SCHEMAS = [
  WEB_SEARCH_TOOL,
  WEB_FETCH_TOOL,
]
