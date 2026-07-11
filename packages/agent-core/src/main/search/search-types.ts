/**
 * Search 模块 — 类型定义
 *
 * 内置网页搜索模块，使用 DuckDuckGo HTML API（无需 API Key）。
 */

/** 搜索结果条目 */
export interface SearchResult {
  title: string
  url: string
  snippet: string
}

/** 搜索响应 */
export interface SearchResponse {
  results: SearchResult[]
  total: number
  query: string
}

/** 抓取的页面内容 */
export interface FetchedPage {
  url: string
  title: string
  content: string
  truncated: boolean
}

/** 工具调用结果 */
export interface SearchToolResult {
  success: boolean
  data?: unknown
  error?: string
  duration?: number
}
