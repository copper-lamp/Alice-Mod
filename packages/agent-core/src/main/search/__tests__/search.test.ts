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

  it('should have default engines', () => {
    const engines = client.getAvailableEngines()
    expect(engines).toContain('bing')
    expect(engines).toContain('baidu')
  })

  it('should handle empty engines gracefully', async () => {
    const emptyClient = new SearchClient([])
    const { results, total } = await emptyClient.search('test', 5)
    expect(total).toBe(0)
    expect(results).toEqual([])
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
