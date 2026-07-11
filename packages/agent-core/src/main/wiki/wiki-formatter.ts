/**
 * wiki-formatter — Wiki 结果格式化
 *
 * 将 Wiki 工具的输出格式化为 Markdown（供 LLM 消费）或 JSON。
 * 参考 free-search-mcp 的渲染风格：清晰、带来源、节约 token。
 */

import type { WikiSearchResult, WikiPageSummary, WikiPageContent } from './wiki-types'

export type Format = 'markdown' | 'json'

/**
 * 渲染搜索结果为 Markdown
 */
export function renderSearchResults(results: WikiSearchResult[], query: string): string {
  if (results.length === 0) {
    return `# 搜索: ${query}\n\n_未找到匹配结果。尝试使用更宽泛的搜索词。_\n`
  }

  const lines: string[] = [
    `# Minecraft Wiki 搜索: ${query}`,
    '',
    `_共 ${results.length} 条结果_`,
    '',
  ]

  for (let i = 0; i < results.length; i++) {
    const r = results[i]
    lines.push(`## ${i + 1}. ${r.title}`)
    lines.push(`<${r.url}>`)
    if (r.description) {
      lines.push('')
      lines.push(`> ${r.description}`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

/**
 * 渲染页面摘要为 Markdown
 */
export function renderPageSummary(page: WikiPageSummary): string {
  const lines: string[] = [
    `# ${page.title}`,
    `<${page.url}>`,
    '',
  ]

  if (page.extract) {
    lines.push(page.extract)
    lines.push('')
  }

  if (page.sections.length > 0) {
    lines.push('## 章节列表')
    lines.push('')
    for (const s of page.sections) {
      lines.push(`- **${s.index}.** ${s.title}`)
    }
    lines.push('')
    lines.push(`_共 ${page.sections.length} 个章节_`)
  }

  return lines.join('\n')
}

/**
 * 渲染页面完整内容为 Markdown（截断到合理长度）
 */
export function renderPageContent(page: WikiPageContent): string {
  const lines: string[] = [
    `# ${page.title}`,
    `<${page.url}>`,
    '',
    page.content.slice(0, 5000),
    '',
  ]

  if (page.content.length > 5000) {
    lines.push('_[内容已截断，使用章节查询获取完整信息]_')
  }

  return lines.join('\n')
}

/**
 * 根据 format 参数格式化结果
 */
export function formatResult<T>(
  data: T,
  renderer: (data: T) => string,
  format: Format = 'markdown',
): string | T {
  if (format === 'json') return data
  return renderer(data)
}
