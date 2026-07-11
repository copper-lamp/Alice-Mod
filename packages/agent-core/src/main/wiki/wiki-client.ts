/**
 * wiki-client — Minecraft Wiki MediaWiki API 客户端
 *
 * 通过 https://minecraft.wiki/api.php 的 MediaWiki API 提供搜索、页面读取功能。
 * 不依赖外部 MCP 服务器，直接调用 RESTful API。
 */

import https from 'node:https'
import type { WikiSearchResult, WikiPageSummary, WikiSection, WikiPageContent, WikiSearchResponse } from './wiki-types'

const DEFAULT_API_URL = 'https://minecraft.wiki/api.php'

export class WikiClient {
  private apiUrl: string

  constructor(apiUrl: string = DEFAULT_API_URL) {
    this.apiUrl = apiUrl
  }

  /**
   * MediaWiki API GET 请求
   */
  private async request(params: Record<string, string>): Promise<unknown> {
    const url = new URL(this.apiUrl)
    url.searchParams.set('format', 'json')
    url.searchParams.set('origin', '*')
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value)
    }

    return new Promise((resolve, reject) => {
      https.get(url.toString(), {
        timeout: 15000,
        headers: {
          'User-Agent': 'McAgent/1.0 (Wiki Module; https://github.com/McAgent)',
          'Accept': 'application/json',
        },
      }, (res) => {
        let data = ''
        res.on('data', (chunk) => { data += chunk })
        res.on('end', () => {
          try {
            resolve(JSON.parse(data))
          } catch (err) {
            reject(new Error(`JSON 解析失败: ${(err as Error).message}`))
          }
        })
      }).on('error', reject).on('timeout', function (this: import('http').ClientRequest) {
        this.destroy()
        reject(new Error('请求超时'))
      })
    })
  }

  /**
   * 搜索 Wiki 页面
   * 使用 opensearch API，返回标题、描述、URL
   */
  async search(query: string, limit: number = 10): Promise<WikiSearchResponse> {
    const raw = await this.request({
      action: 'opensearch',
      search: query,
      limit: String(limit),
      namespace: '0',
      redirects: 'resolve',
    }) as [string, string[], string[], string[]]

    // opensearch 返回 [query, [title, ...], [description, ...], [url, ...]]
    const titles: string[] = raw[1] ?? []
    const descriptions: string[] = raw[2] ?? []
    const urls: string[] = raw[3] ?? []

    const results: WikiSearchResult[] = titles.map((title, i) => ({
      title,
      description: descriptions[i] ?? '',
      url: urls[i] ?? `https://minecraft.wiki/w/${encodeURIComponent(title)}`,
    }))

    return { results, total: results.length }
  }

  /**
   * 获取页面摘要
   * 使用 query+extracts API，返回简介和章节列表
   */
  async getPageSummary(title: string): Promise<WikiPageSummary | null> {
    // 获取页面提取内容
    const extractRaw = await this.request({
      action: 'query',
      titles: title,
      prop: 'extracts',
      exintro: '1',
      explaintext: '1',
      redirects: '1',
    }) as Record<string, unknown>

    const pages = (extractRaw as any).query?.pages as Record<string, any> ?? {}
    const pageId = Object.keys(pages)[0]
    if (!pageId || pageId === '-1') return null

    const page = pages[pageId]
    const pageTitle = page.title ?? title

    // 获取章节列表
    const sectionsRaw = await this.request({
      action: 'parse',
      page: pageTitle,
      prop: 'sections',
      redirects: '1',
    }) as Record<string, unknown>

    const sectionsData = (sectionsRaw as any).parse?.sections as any[] ?? []
    const sections: WikiSection[] = sectionsData.map((s: any) => ({
      index: s.index,
      title: s.line,
      anchor: s.anchor,
    }))

    return {
      title: pageTitle,
      url: `https://minecraft.wiki/w/${encodeURIComponent(pageTitle)}`,
      extract: page.extract ?? '',
      sections,
    }
  }

  /**
   * 获取页面完整内容
   * 使用 parse API，返回完整 HTML 内容
   */
  async getPageContent(title: string): Promise<WikiPageContent | null> {
    const summary = await this.getPageSummary(title)
    if (!summary) return null

    const contentRaw = await this.request({
      action: 'parse',
      page: title,
      prop: 'text',
      redirects: '1',
    }) as Record<string, unknown>

    const html = (contentRaw as any).parse?.text?.['*'] as string ?? ''

    return {
      ...summary,
      content: this.stripHtml(html),
    }
  }

  /**
   * 获取页面特定章节内容
   */
  async getSection(title: string, sectionIndex: number): Promise<{ title: string; content: string } | null> {
    const raw = await this.request({
      action: 'parse',
      page: title,
      prop: 'text',
      section: String(sectionIndex),
      redirects: '1',
    }) as Record<string, unknown>

    const html = (raw as any).parse?.text?.['*'] as string ?? ''
    const pageTitle = (raw as any).parse?.title ?? title

    if (!html) return null

    return {
      title: pageTitle,
      content: this.stripHtml(html),
    }
  }

  /**
   * 简单的 HTML 标签剥离（获取纯文本）
   */
  private stripHtml(html: string): string {
    return html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 8000) // 限制最大 8000 字符
  }
}
