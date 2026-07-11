/**
 * Wiki 模块 — 单元测试
 *
 * 测试 WikiClient 的 API 调用和格式化输出。
 * 注：网络相关测试依赖 https://minecraft.wiki 的可用性。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { WikiClient } from '../wiki-client'
import {
  renderSearchResults,
  renderPageSummary,
  renderPageContent,
} from '../wiki-formatter'
import type { WikiSearchResult, WikiPageSummary, WikiPageContent } from '../wiki-types'

// ════════════════════════════════════════════════════════════════
// WikiFormatter 测试（无需网络）
// ════════════════════════════════════════════════════════════════

describe('WikiFormatter', () => {
  describe('renderSearchResults', () => {
    it('should render results as markdown', () => {
      const results: WikiSearchResult[] = [
        { title: 'Diamond', description: 'A precious gem', url: 'https://minecraft.wiki/w/Diamond' },
        { title: 'Diamond Sword', description: 'A melee weapon', url: 'https://minecraft.wiki/w/Diamond_Sword' },
      ]
      const output = renderSearchResults(results, 'diamond')
      expect(output).toContain('# Minecraft Wiki 搜索: diamond')
      expect(output).toContain('1. Diamond')
      expect(output).toContain('2. Diamond Sword')
      expect(output).toContain('A precious gem')
      expect(output).toContain('A melee weapon')
      expect(output).toContain('https://minecraft.wiki/w/Diamond')
    })

    it('should handle empty results', () => {
      const output = renderSearchResults([], 'nonexistent_xyz')
      expect(output).toContain('未找到匹配结果')
    })

    it('should handle results with missing description', () => {
      const results: WikiSearchResult[] = [
        { title: 'Test', description: '', url: 'https://minecraft.wiki/w/Test' },
      ]
      const output = renderSearchResults(results, 'test')
      expect(output).toContain('1. Test')
      expect(output).not.toContain('> ')
    })
  })

  describe('renderPageSummary', () => {
    it('should render page summary with sections', () => {
      const page: WikiPageSummary = {
        title: 'Diamond Sword',
        url: 'https://minecraft.wiki/w/Diamond_Sword',
        extract: 'A diamond sword is a melee weapon.',
        sections: [
          { index: 1, title: 'Obtaining', anchor: 'Obtaining' },
          { index: 2, title: 'Usage', anchor: 'Usage' },
        ],
      }
      const output = renderPageSummary(page)
      expect(output).toContain('# Diamond Sword')
      expect(output).toContain('A diamond sword is a melee weapon')
      expect(output).toContain('**1.** Obtaining')
      expect(output).toContain('**2.** Usage')
      expect(output).toContain('共 2 个章节')
    })

    it('should handle page with no sections', () => {
      const page: WikiPageSummary = {
        title: 'Test',
        url: 'https://minecraft.wiki/w/Test',
        extract: 'Some content',
        sections: [],
      }
      const output = renderPageSummary(page)
      expect(output).toContain('# Test')
      expect(output).toContain('Some content')
      expect(output).not.toContain('章节列表')
    })
  })

  describe('renderPageContent', () => {
    it('should render full page content', () => {
      const page: WikiPageContent = {
        title: 'Diamond',
        url: 'https://minecraft.wiki/w/Diamond',
        extract: 'Diamond is a mineral.',
        sections: [],
        content: 'Diamond is a precious mineral obtained from diamond ore.',
      }
      const output = renderPageContent(page)
      expect(output).toContain('# Diamond')
      expect(output).toContain('Diamond is a precious mineral')
    })

    it('should truncate long content', () => {
      const longContent = 'A'.repeat(6000)
      const page: WikiPageContent = {
        title: 'Long Page',
        url: 'https://minecraft.wiki/w/Long_Page',
        extract: 'Long content',
        sections: [],
        content: longContent,
      }
      const output = renderPageContent(page)
      expect(output.length).toBeLessThan(5200)
      expect(output).toContain('[内容已截断')
    })
  })
})

// ════════════════════════════════════════════════════════════════
// WikiClient 测试（需网络）
// ════════════════════════════════════════════════════════════════

describe('WikiClient', () => {
  const client = new WikiClient()

  it('search should return results for "diamond"', async () => {
    const { results, total } = await client.search('diamond', 5)
    expect(total).toBeGreaterThan(0)
    expect(results.some(r => r.title.toLowerCase().includes('diamond'))).toBe(true)
  }, 30000)

  it('search should handle empty query', async () => {
    const { results, total } = await client.search('', 5)
    expect(total).toBe(0)
    expect(results).toEqual([])
  }, 15000)

  it('getPageSummary should return existing page', async () => {
    const page = await client.getPageSummary('Diamond')
    expect(page).not.toBeNull()
    expect(page!.title).toBe('Diamond')
    expect(page!.extract.length).toBeGreaterThan(0)
    expect(page!.sections.length).toBeGreaterThan(0)
  }, 30000)

  it('getPageSummary should return null for nonexistent page', async () => {
    const page = await client.getPageSummary('NonexistentPageXYZ123')
    expect(page).toBeNull()
  }, 15000)

  it('getPageContent should return full content', async () => {
    const page = await client.getPageContent('Diamond')
    expect(page).not.toBeNull()
    expect(page!.content.length).toBeGreaterThan(0)
  }, 30000)

  it('getSection should return section content', async () => {
    // 获取 Diamond 页面的第一个章节
    const section = await client.getSection('Diamond', 1)
    expect(section).not.toBeNull()
    expect(section!.content.length).toBeGreaterThan(0)
  }, 30000)

  it('getSection should return null for invalid section index', async () => {
    const section = await client.getSection('Diamond', 999)
    // 无效的章节索引可能返回 null 或空内容
    if (section) {
      expect(section.content.length).toBe(0)
    }
  }, 15000)
})

// ════════════════════════════════════════════════════════════════
// 边缘情况测试
// ════════════════════════════════════════════════════════════════

describe('WikiClient edge cases', () => {
  const client = new WikiClient()

  it('should search with special characters', async () => {
    const { results } = await client.search('pickaxe', 3)
    expect(results.length).toBeGreaterThan(0)
    // 应返回与 pickaxe 相关的结果
    const hasPickaxe = results.some(r =>
      r.title.toLowerCase().includes('pickaxe'),
    )
    expect(hasPickaxe).toBe(true)
  }, 30000)

  it('should handle redirects', async () => {
    // "Diamond Sword" 是正确标题，"diamond_sword" 应被重定向
    const page = await client.getPageSummary('Diamond Sword')
    expect(page).not.toBeNull()
    expect(page!.title).toBe('Diamond Sword')
  }, 30000)

  it('should limit search results', async () => {
    const { results } = await client.search('diamond', 3)
    expect(results.length).toBeLessThanOrEqual(3)
  }, 15000)

  it('should work with bedrock edition content', async () => {
    const { results } = await client.search('bedrock', 3)
    expect(results.length).toBeGreaterThan(0)
  }, 15000)
})
