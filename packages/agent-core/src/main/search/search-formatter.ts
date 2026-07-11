/**
 * search-formatter — 搜索结果格式化
 *
 * 参考 free-search-mcp 的格式风格：编号列表 + 来源 + 摘要。
 */

import type { SearchResult, FetchedPage } from './search-types'

export type Format = 'markdown' | 'json'

export function renderSearchResults(results: SearchResult[], query: string): string {
  if (results.length === 0) {
    return `# 搜索: ${query}\n\n_未找到匹配结果。尝试使用更宽泛的关键词。_\n`
  }

  const lines: string[] = [
    `# 网页搜索: ${query}`,
    '',
    `_共 ${results.length} 条结果_`,
    '',
  ]

  for (let i = 0; i < results.length; i++) {
    const r = results[i]
    lines.push(`## ${i + 1}. ${r.title}`)
    lines.push(`<${r.url}>`)
    if (r.snippet) {
      lines.push('')
      lines.push(`> ${r.snippet}`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

export function renderFetchedPage(page: FetchedPage): string {
  const lines: string[] = [
    `# ${page.title}`,
    `<${page.url}>`,
    '',
    page.content,
    '',
  ]

  if (page.truncated) {
    lines.push('_[内容已截断]_')
  }

  return lines.join('\n')
}

export function formatResult<T>(
  data: T,
  renderer: (data: T) => string,
  format: Format = 'markdown',
): string | T {
  if (format === 'json') return data
  return renderer(data)
}
