/**
 * Wiki 模块 — 入口
 *
 * Minecraft Wiki (MediaWiki API) 集成模块。
 * 提供 3 个工具供 LLM 调用 + 3 个 IPC 通道供前端调用。
 */

import { WIKI_SEARCH_TOOL, WIKI_GET_PAGE_TOOL, WIKI_GET_SECTION_TOOL } from './wiki-tools'

export { WikiClient } from './wiki-client'
export { setWikiClient, getWikiClient, registerWikiHandlers } from './wiki-handler'
export { WIKI_SEARCH_TOOL, WIKI_GET_PAGE_TOOL, WIKI_GET_SECTION_TOOL } from './wiki-tools'
export { wikiSearch, wikiGetPage, wikiGetSection } from './wiki-tools'
export { renderSearchResults, renderPageSummary, renderPageContent } from './wiki-formatter'
export type { Format } from './wiki-formatter'
export type { WikiSearchResult, WikiPageSummary, WikiPageContent, WikiSection, WikiSearchResponse } from './wiki-types'

/** 所有 Wiki 工具的 Schema 列表（用于注册到 ToolRegistry） */
export const WIKI_TOOL_SCHEMAS = [
  WIKI_SEARCH_TOOL,
  WIKI_GET_PAGE_TOOL,
  WIKI_GET_SECTION_TOOL,
]
