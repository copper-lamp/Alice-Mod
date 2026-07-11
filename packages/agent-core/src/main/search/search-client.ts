/**
 * search-client — 网页搜索客户端
 *
 * 使用 DuckDuckGo HTML API（免费、无需 API Key）进行网页搜索。
 * 参考 free-search-mcp 的实现思路。
 */

import https from 'node:https'
import http from 'node:http'
import type { SearchResult, SearchResponse, FetchedPage } from './search-types'

const DDG_HTML_URL = 'https://html.duckduckgo.com/html'
const DDG_API_URL = 'https://api.duckduckgo.com'

export class SearchClient {
  private userAgent: string

  constructor(userAgent?: string) {
    this.userAgent = userAgent ?? 'McAgent/1.0 (Search Module; https://github.com/McAgent)'
  }

  /**
   * HTTP GET 请求
   */
  private async fetch(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const client = url.startsWith('https') ? https : http
      client.get(url, {
        timeout: 15000,
        headers: {
          'User-Agent': this.userAgent,
          'Accept': 'text/html,application/xhtml+xml',
        },
      }, (res) => {
        let data = ''
        res.on('data', (chunk) => { data += chunk })
        res.on('end', () => resolve(data))
      }).on('error', reject).on('timeout', function (this: import('http').ClientRequest) {
        this.destroy()
        reject(new Error('请求超时'))
      })
    })
  }

  /**
   * 搜索网页
   * 先尝试 DuckDuckGo Instant Answer API，如果结果不足再回退到 HTML 搜索
   */
  async search(query: string, maxResults: number = 8): Promise<SearchResponse> {
    if (!query.trim()) {
      return { results: [], total: 0, query }
    }

    // 尝试 Instant Answer API
    try {
      const apiResults = await this.searchViaApi(query, maxResults)
      if (apiResults.length > 0) {
        return { results: apiResults, total: apiResults.length, query }
      }
    } catch {
      // API 失败，回退到 HTML 搜索
    }

    // 回退：HTML 搜索
    try {
      const html = await this.fetch(`${DDG_HTML_URL}?q=${encodeURIComponent(query)}`)
      const results = this.parseDdgHtml(html, query).slice(0, maxResults)
      return { results, total: results.length, query }
    } catch (err) {
      throw err
    }
  }

  /**
   * 使用 DuckDuckGo Instant Answer API 搜索
   * https://api.duckduckgo.com/?q=query&format=json&no_html=1
   */
  private async searchViaApi(query: string, maxResults: number): Promise<SearchResult[]> {
    const url = `${DDG_API_URL}/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`
    const text = await this.fetch(url)
    const data = JSON.parse(text)

    const results: SearchResult[] = []

    // 提取 RelatedTopics
    const topics = data.RelatedTopics ?? []
    for (const topic of topics) {
      if (topic.Result) {
        const urlMatch = topic.Result.match(/href="([^"]+)"/)
        results.push({
          title: topic.Text?.split(' - ')[0] ?? topic.Text ?? '',
          url: urlMatch ? urlMatch[1] : '',
          snippet: topic.Text ?? '',
        })
      } else if (topic.Topics) {
        for (const sub of topic.Topics) {
          const urlMatch = sub.Result?.match(/href="([^"]+)"/)
          results.push({
            title: sub.Text?.split(' - ')[0] ?? sub.Text ?? '',
            url: urlMatch ? urlMatch[1] : '',
            snippet: sub.Text ?? '',
          })
        }
      }
      if (results.length >= maxResults) break
    }

    // 提取 Abstract
    if (data.AbstractText) {
      results.unshift({
        title: data.Heading ?? '',
        url: data.AbstractURL ?? '',
        snippet: data.AbstractText,
      })
    }

    return results.slice(0, maxResults)
  }

  /**
   * 解析 DuckDuckGo HTML 搜索结果
   */
  private parseDdgHtml(html: string, _query: string): SearchResult[] {
    const results: SearchResult[] = []
    const seen = new Set<string>()

    // 匹配 DuckDuckGo 的 HTML 结果行
    // 查找所有 <a class="result__a" ...> 标题 </a>
    const linkRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi
    // 查找对应的 snippet: <a class="result__snippet" ...> 摘要 </a>
    const snippetRegex = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi

    const links: Array<{ url: string; title: string }> = []
    let match

    while ((match = linkRegex.exec(html)) !== null) {
      let url = this.cleanDdgUrl(match[1])
      const title = this.stripTags(match[2]).trim()
      if (url && title && !seen.has(url)) {
        seen.add(url)
        links.push({ url, title })
      }
    }

    const snippets: string[] = []
    while ((match = snippetRegex.exec(html)) !== null) {
      snippets.push(this.stripTags(match[1]).trim())
    }

    for (let i = 0; i < links.length; i++) {
      results.push({
        title: links[i].title,
        url: links[i].url,
        snippet: snippets[i] ?? '',
      })
    }

    return results
  }

  /**
   * 清理 DuckDuckGo 的跳转链接
   */
  private cleanDdgUrl(url: string): string {
    if (!url) return ''
    // 处理 DDG 的重定向链接
    const redirectMatch = url.match(/uddg=([^&]+)/)
    if (redirectMatch) {
      return decodeURIComponent(redirectMatch[1])
    }
    if (url.startsWith('//')) return 'https:' + url
    return url
  }

  /**
   * 简单的 HTML 标签剥离
   */
  private stripTags(html: string): string {
    return html
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, ' ')
      .trim()
  }

  /**
   * 抓取并提取 URL 正文内容
   */
  async fetchPage(url: string, maxChars: number = 5000): Promise<FetchedPage> {
    const html = await this.fetch(url)
    const title = this.extractTitle(html)
    const content = this.extractMainContent(html).slice(0, maxChars)

    return {
      url,
      title,
      content,
      truncated: content.length >= maxChars,
    }
  }

  /**
   * 从 HTML 提取标题
   */
  private extractTitle(html: string): string {
    const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
    return match ? this.stripTags(match[1]) : ''
  }

  /**
   * 从 HTML 提取正文内容（移除脚本、样式等）
   */
  private extractMainContent(html: string): string {
    // 移除 script、style、nav、footer、header 等
    let text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
      .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
      .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
      .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, '')

    // 尝试提取 <main> 或 <article> 内容
    const mainMatch = text.match(/<main[^>]*>([\s\S]*?)<\/main>/i)
      ?? text.match(/<article[^>]*>([\s\S]*?)<\/article>/i)

    if (mainMatch) {
      text = mainMatch[1]
    }

    return this.stripTags(text)
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  }
}
