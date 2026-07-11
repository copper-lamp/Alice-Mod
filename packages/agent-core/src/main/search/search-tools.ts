/**
 * search-tools — 搜索工具定义
 *
 * 2 个 ToolSchema：web_search、web_fetch。
 */

import type { ToolSchema, ToolResult } from '@mcagent/shared'
import { SearchClient } from './search-client'
import { renderSearchResults, renderFetchedPage } from './search-formatter'
import type { Format } from './search-formatter'

// ════════════════════════════════════════════════════════════════
// 1. web_search — 网页搜索
// ════════════════════════════════════════════════════════════════

export const WEB_SEARCH_TOOL: ToolSchema = {
  name: 'web_search',
  description: '搜索互联网，查找实时信息。适用于 LLM 知识截止日期之后的查询、需要最新数据的问题。支持新闻、文章、文档等各类网页。返回编号列表（标题 + URL + 摘要）。',
  category: 'knowledge' as any,
  parameters: {
    query: {
      type: 'string',
      description: '搜索关键词，自然语言即可',
      required: true,
    },
    limit: {
      type: 'number',
      description: '返回结果数量上限（默认 5，最大 10）',
      required: false,
    },
    format: {
      type: 'string',
      description: '输出格式：markdown（默认）或 json',
      required: false,
    },
  },
}

export async function webSearch(
  client: SearchClient,
  params: { query: string; limit?: number; format?: Format },
): Promise<ToolResult<string>> {
  const start = Date.now()
  try {
    if (!params.query?.trim()) {
      return { success: true, data: '_搜索词不能为空_\n', duration: 0 }
    }
    const response = await client.search(params.query, Math.min(params.limit ?? 5, 10))
    const data = renderSearchResults(response.results, params.query)
    return { success: true, data, duration: Date.now() - start }
  } catch (err) {
    return {
      success: false,
      error: `搜索失败: ${(err as Error).message}`,
      duration: Date.now() - start,
    }
  }
}

// ════════════════════════════════════════════════════════════════
// 2. web_fetch — 获取网页内容
// ════════════════════════════════════════════════════════════════

export const WEB_FETCH_TOOL: ToolSchema = {
  name: 'web_fetch',
  description: '获取指定 URL 的网页内容，提取正文。适用于阅读搜索结果中的具体文章、文档等。返回 Markdown 格式的文本内容。',
  category: 'knowledge' as any,
  parameters: {
    url: {
      type: 'string',
      description: '要读取的完整 URL（http/https）',
      required: true,
    },
    format: {
      type: 'string',
      description: '输出格式：markdown（默认）或 json',
      required: false,
    },
  },
}

export async function webFetch(
  client: SearchClient,
  params: { url: string; format?: Format },
): Promise<ToolResult<string>> {
  const start = Date.now()
  try {
    if (!params.url?.startsWith('http')) {
      return { success: false, error: 'URL 必须以 http:// 或 https:// 开头', duration: Date.now() - start }
    }
    const page = await client.fetchPage(params.url)
    const data = renderFetchedPage(page)
    return { success: true, data, duration: Date.now() - start }
  } catch (err) {
    return {
      success: false,
      error: `获取页面失败: ${(err as Error).message}`,
      duration: Date.now() - start,
    }
  }
}
