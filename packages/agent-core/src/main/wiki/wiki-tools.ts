/**
 * wiki-tools — Minecraft Wiki 工具定义
 *
 * 3 个 ToolSchema 定义 + 对应的执行函数。
 * 供 LLM 在对话中直接调用 Minecraft Wiki 查询。
 */

import type { ToolSchema, ToolResult } from '@mcagent/shared'
import { ToolCategory } from '@mcagent/shared'
import { WikiClient } from './wiki-client'
import { renderSearchResults, renderPageSummary, renderPageContent } from './wiki-formatter'
import type { Format } from './wiki-formatter'

// ════════════════════════════════════════════════════════════════
// 1. wiki_search — 搜索 Wiki
// ════════════════════════════════════════════════════════════════

export const WIKI_SEARCH_TOOL: ToolSchema = {
  name: 'minecraft_wiki_search',
  description: '搜索 Minecraft Wiki，查找物品、方块、生物、结构等页面的标题和简介。适用于需要查找 Minecraft 游戏内任何内容的场景。返回编号列表（标题 + URL + 描述）。',
  category: 'knowledge' as any,
  parameters: {
    query: {
      type: 'string',
      description: '搜索关键词，如 "diamond sword"、"苦力怕"、"下界合金装备"',
      required: true,
    },
    limit: {
      type: 'number',
      description: '返回结果数量上限（默认 5，最大 20）',
      required: false,
    },
    format: {
      type: 'string',
      description: '输出格式：markdown（默认，LLM 友好）或 json',
      required: false,
    },
  },
}

export async function wikiSearch(
  client: WikiClient,
  params: { query: string; limit?: number; format?: Format },
): Promise<ToolResult<string>> {
  const start = Date.now()
  try {
    if (!params.query?.trim()) {
      return { success: true, data: '_搜索词不能为空_\n', duration: 0 }
    }
    const { results } = await client.search(params.query, Math.min(params.limit ?? 5, 20))
    const data = renderSearchResults(results, params.query)
    return { success: true, data, duration: Date.now() - start }
  } catch (err) {
    return {
      success: false,
      error: `Wiki 搜索失败: ${(err as Error).message}`,
      duration: Date.now() - start,
    }
  }
}

// ════════════════════════════════════════════════════════════════
// 2. wiki_get_page — 获取页面摘要/内容
// ════════════════════════════════════════════════════════════════

export const WIKI_GET_PAGE_TOOL: ToolSchema = {
  name: 'minecraft_wiki_get_page',
  description: '获取 Minecraft Wiki 页面的摘要（简介 + 章节列表）或完整内容。先用 wiki_search 获取精确标题后调用此工具。',
  category: 'knowledge' as any,
  parameters: {
    title: {
      type: 'string',
      description: '页面标题（精确，如 "Diamond Sword"），来自 wiki_search 的结果',
      required: true,
    },
    mode: {
      type: 'string',
      description: 'summary=仅摘要+章节列表（默认）, full=完整页面内容',
      required: false,
    },
    format: {
      type: 'string',
      description: '输出格式：markdown（默认）或 json',
      required: false,
    },
  },
}

export async function wikiGetPage(
  client: WikiClient,
  params: { title: string; mode?: 'summary' | 'full'; format?: Format },
): Promise<ToolResult<string>> {
  const start = Date.now()
  try {
    if (params.mode === 'full') {
      const page = await client.getPageContent(params.title)
      if (!page) {
        return { success: false, error: `页面 "${params.title}" 不存在`, duration: Date.now() - start }
      }
      const data = renderPageContent(page)
      return { success: true, data, duration: Date.now() - start }
    }

    const summary = await client.getPageSummary(params.title)
    if (!summary) {
      return { success: false, error: `页面 "${params.title}" 不存在`, duration: Date.now() - start }
    }
    const data = renderPageSummary(summary)
    return { success: true, data, duration: Date.now() - start }
  } catch (err) {
    return {
      success: false,
      error: `获取页面失败: ${(err as Error).message}`,
      duration: Date.now() - start,
    }
  }
}

// ════════════════════════════════════════════════════════════════
// 3. wiki_get_section — 获取章节内容
// ════════════════════════════════════════════════════════════════

export const WIKI_GET_SECTION_TOOL: ToolSchema = {
  name: 'minecraft_wiki_get_section',
  description: '读取 Wiki 页面特定章节的详细内容。先用 wiki_get_page 获取章节索引后，再用此工具获取具体内容。',
  category: 'knowledge' as any,
  parameters: {
    title: {
      type: 'string',
      description: '页面标题（精确，如 "Diamond Sword"）',
      required: true,
    },
    section_index: {
      type: 'number',
      description: '章节编号（从 wiki_get_page 返回的章节列表中获得，如 1, 2, 3）',
      required: true,
    },
    format: {
      type: 'string',
      description: '输出格式：markdown（默认）或 json',
      required: false,
    },
  },
}

export async function wikiGetSection(
  client: WikiClient,
  params: { title: string; section_index: number; format?: Format },
): Promise<ToolResult<string>> {
  const start = Date.now()
  try {
    const section = await client.getSection(params.title, params.section_index)
    if (!section) {
      return { success: false, error: `章节 ${params.section_index} 不存在`, duration: Date.now() - start }
    }
    const data = `# ${section.title}\n\n${section.content}`
    return { success: true, data, duration: Date.now() - start }
  } catch (err) {
    return {
      success: false,
      error: `获取章节失败: ${(err as Error).message}`,
      duration: Date.now() - start,
    }
  }
}
