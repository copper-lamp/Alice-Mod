/**
 * Search 模块 — 单元测试
 */

import { describe, it, expect } from 'vitest'
import { SearchClient } from '../search-client'
import { renderSearchResults, renderFetchedPage } from '../search-formatter'
import type { SearchResult, FetchedPage } from '../search-types'

// ════════════════════════════════════════════════════════════════
// Formatter 测试（无需网络）
// ════════════════════════════════════════════════════════════════

describe('SearchFormatter', () => {
  it('should render results as markdown', () => {
    const results: SearchResult[] = [
      { title: 'Test Result', url: 'https://example.com', snippet: 'A test snippet' },
    ]
    const output = renderSearchResults(results, 'test')
    expect(output).toContain('# 网页搜索: test')
    expect(output).toContain('1. Test Result')
    expect(output).toContain('https://example.com')
    expect(output).toContain('A test snippet')
  })

  it('should handle empty results', () => {
    const output = renderSearchResults([], 'nothing')
    expect(output).toContain('未找到匹配结果')
  })

  it('should render fetched page', () => {
    const page: FetchedPage = {
      url: 'https://example.com',
      title: 'Example Page',
      content: 'Some content here',
      truncated: false,
    }
    const output = renderFetchedPage(page)
    expect(output).toContain('Example Page')
    expect(output).toContain('Some content here')
  })

  it('should mark truncated pages', () => {
    const page: FetchedPage = {
      url: 'https://example.com',
      title: 'Long Page',
      content: 'A'.repeat(100),
      truncated: true,
    }
    const output = renderFetchedPage(page)
    expect(output).toContain('[内容已截断]')
  })
})

// ════════════════════════════════════════════════════════════════
// SearchClient 测试
// ════════════════════════════════════════════════════════════════

describe('SearchClient', () => {
  const client = new SearchClient()

  it('should return empty for empty query', async () => {
    const { results, total } = await client.search('', 5)
    expect(total).toBe(0)
    expect(results).toEqual([])
  })

  it('should parse DDG HTML correctly', () => {
    // DuckDuckGo HTML 格式的模拟响应
    const mockHtml = `
      <html><body>
      <div class="result">
        <a class="result__a" href="https://example.com/test">Test Title</a>
        <a class="result__snippet">Test snippet content</a>
      </div>
      <div class="result">
        <a class="result__a" href="/redirect?uddg=https%3A%2F%2Fexample.org">Another Result</a>
        <a class="result__snippet">Another snippet</a>
      </div>
      </body></html>
    `
    const results = (client as any).parseDdgHtml(mockHtml, 'test')
    expect(results.length).toBe(2)
    expect(results[0].title).toBe('Test Title')
    expect(results[0].url).toBe('https://example.com/test')
    expect(results[0].snippet).toBe('Test snippet content')
    expect(results[1].title).toBe('Another Result')
  })

  it('should strip HTML tags correctly', () => {
    const html = '<p>Hello <b>World</b> &amp; Friends</p>'
    const result = (client as any).stripTags(html)
    expect(result).toBe('Hello World & Friends')
  })
})

describe('SearchClient fetchPage', () => {
  const client = new SearchClient()

  it('should fetch a real page', async () => {
    const page = await client.fetchPage('https://example.com')
    expect(page.title).toBeDefined()
    expect(page.content.length).toBeGreaterThan(0)
    expect(page.url).toBe('https://example.com')
  }, 30000)

  it('should handle invalid URL', async () => {
    await expect(client.fetchPage('not-a-url'))
      .rejects.toThrow()
  }, 15000)
})
