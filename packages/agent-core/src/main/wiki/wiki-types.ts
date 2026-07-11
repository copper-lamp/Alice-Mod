/**
 * Wiki 模块 — 类型定义
 *
 * Minecraft Wiki (MediaWiki API) 集成模块的类型定义。
 */

/** Wiki 搜索条目 */
export interface WikiSearchResult {
  title: string
  description: string
  url: string
}

/** Wiki 页面摘要 */
export interface WikiPageSummary {
  title: string
  url: string
  extract: string
  sections: WikiSection[]
}

/** Wiki 页面章节 */
export interface WikiSection {
  index: number
  title: string
  anchor: string
}

/** Wiki 页面内容（含原始 wikitext） */
export interface WikiPageContent extends WikiPageSummary {
  content: string
}

/** Wiki 搜索响应 */
export interface WikiSearchResponse {
  results: WikiSearchResult[]
  total: number
}

/** Wiki 查询模式 */
export type WikiQueryMode = 'summary' | 'full'

/** Wiki 工具调用结果 */
export interface WikiToolResult {
  success: boolean
  data?: unknown
  error?: string
  duration?: number
}
