/**
 * search-client — 网页搜索客户端
 *
 * 多引擎网页搜索，默认使用 Bing HTML 搜索（国内可访问，无需 API Key）。
 * 引擎优先级：Bing → 百度 → DuckDuckGo
 *
 * 参考 free-search-mcp 的多引擎聚合思路，但以 TypeScript 原生实现，
 * 无需额外 MCP 进程依赖。
 */

import https from 'node:https'
import http from 'node:http'
import type { SearchResult, SearchResponse, FetchedPage } from './search-types'

// ════════════════════════════════════════════════════════════════
// 引擎接口
// ════════════════════════════════════════════════════════════════

interface SearchEngine {
  readonly name: string
  search(query: string, maxResults: number): Promise<SearchResult[]>
}

// ════════════════════════════════════════════════════════════════
// HTTP 工具
// ════════════════════════════════════════════════════════════════

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

async function httpGet(url: string, timeout = 15000): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http
    const req = client.get(
      url,
      {
        timeout,
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        },
      },
      (res) => {
        // 跟随重定向
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const redirectUrl = res.headers.location.startsWith('http')
            ? res.headers.location
            : new URL(res.headers.location, url).href
          httpGet(redirectUrl, timeout).then(resolve).catch(reject)
          return
        }
        let data = ''
        res.on('data', (chunk: string) => { data += chunk })
        res.on('end', () => resolve(data))
      },
    )
    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('请求超时'))
    })
  })
}

function stripTags(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, n) => String.fromCharCode(Number.parseInt(n, 16)))
    .replace(/\s+/g, ' ')
    .trim()
}

// ════════════════════════════════════════════════════════════════
// 1. Bing 搜索引擎（默认）
// ════════════════════════════════════════════════════════════════

const BING_SEARCH_URL = 'https://www.bing.com/search'

class BingEngine implements SearchEngine {
  readonly name = 'bing'

  async search(query: string, maxResults: number): Promise<SearchResult[]> {
    const url = `${BING_SEARCH_URL}?q=${encodeURIComponent(query)}&count=${maxResults}&setlang=zh-Hans`
    const html = await httpGet(url)
    return this.parseHtml(html, maxResults)
  }

  private parseHtml(html: string, maxResults: number): SearchResult[] {
    const results: SearchResult[] = []
    const seen = new Set<string>()

    // Bing 的结果结构：
    // <li class="b_algo">
    //   <h2><a href="...">标题</a></h2>
    //   <p>摘要</p>
    // </li>
    const algoRegex = /<li[^>]*class="b_algo"[^>]*>([\s\S]*?)<\/li>/gi
    let match: RegExpExecArray | null

    while ((match = algoRegex.exec(html)) !== null) {
      if (results.length >= maxResults) break

      const block = match[1]

      // 提取标题和 URL
      const linkMatch = block.match(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i)
      if (!linkMatch) continue

      const url = linkMatch[1]
      const title = stripTags(linkMatch[2])

      if (!url || !title || seen.has(url)) continue
      // 跳过 Bing 内部链接
      if (url.startsWith('https://www.bing.com/') && !url.includes('search?')) continue

      seen.add(url)

      // 提取摘要
      const snippetMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i)
      const snippet = snippetMatch ? stripTags(snippetMatch[1]) : ''

      results.push({ title, url, snippet })
    }

    return results
  }
}

// ════════════════════════════════════════════════════════════════
// 2. 百度搜索引擎（国内兜底）
// ════════════════════════════════════════════════════════════════

const BAIDU_SEARCH_URL = 'https://www.baidu.com/s'

class BaiduEngine implements SearchEngine {
  readonly name = 'baidu'

  async search(query: string, maxResults: number): Promise<SearchResult[]> {
    const url = `${BAIDU_SEARCH_URL}?wd=${encodeURIComponent(query)}&rn=${maxResults}`
    const html = await httpGet(url)
    return this.parseHtml(html, maxResults)
  }

  private parseHtml(html: string, maxResults: number): SearchResult[] {
    const results: SearchResult[] = []
    const seen = new Set<string>()

    // 百度结果结构：
    // <div class="result c-container" id="...">
    //   <h3 class="t"><a href="...">标题</a></h3>
    //   <div class="c-abstract">摘要</div>
    // </div>
    const resultRegex = /<div[^>]*class="result[^"]*c-container[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi
    let match: RegExpExecArray | null

    while ((match = resultRegex.exec(html)) !== null) {
      if (results.length >= maxResults) break

      const block = match[1]

      // 提取标题和 URL
      const linkMatch = block.match(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i)
      if (!linkMatch) continue

      let url = linkMatch[1]
      const title = stripTags(linkMatch[2])

      if (!url || !title || seen.has(url)) continue

      // 百度搜索结果链接是跳转链接，尝试提取真实 URL
      if (url.includes('baidu.com/link?') || url.includes('baidu.com/s?wd=')) {
        // 保留百度跳转链接也可用
      }

      seen.add(url)

      // 提取摘要
      const snippetMatch = block.match(/<div[^>]*class="c-abstract"[^>]*>([\s\S]*?)<\/div>/i)
        || block.match(/<span[^>]*class="content-right_[^"]*"[^>]*>([\s\S]*?)<\/span>/i)
      const snippet = snippetMatch ? stripTags(snippetMatch[1]) : ''

      results.push({ title, url, snippet })
    }

    return results
  }
}

// ════════════════════════════════════════════════════════════════
// 3. DuckDuckGo 搜索引擎（备用）
// ════════════════════════════════════════════════════════════════

const DDG_HTML_URL = 'https://html.duckduckgo.com/html'

class DuckDuckGoEngine implements SearchEngine {
  readonly name = 'duckduckgo'

  async search(query: string, maxResults: number): Promise<SearchResult[]> {
    const url = `${DDG_HTML_URL}?q=${encodeURIComponent(query)}`
    const html = await httpGet(url)
    return this.parseHtml(html, maxResults)
  }

  private parseHtml(html: string, maxResults: number): SearchResult[] {
    const results: SearchResult[] = []
    const seen = new Set<string>()

    // DuckDuckGo HTML 结果
    // <a class="result__a" href="...">标题</a>
    // <a class="result__snippet">摘要</a>
    const linkRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi
    const snippetRegex = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi

    const links: Array<{ url: string; title: string }> = []
    let match: RegExpExecArray | null

    while ((match = linkRegex.exec(html)) !== null) {
      let url = match[1]
      // 处理 DDG 重定向链接
      const redirectMatch = url.match(/uddg=([^&]+)/)
      if (redirectMatch) {
        url = decodeURIComponent(redirectMatch[1])
      } else if (url.startsWith('//')) {
        url = 'https:' + url
      }
      const title = stripTags(match[2]).trim()
      if (url && title && !seen.has(url)) {
        seen.add(url)
        links.push({ url, title })
      }
    }

    const snippets: string[] = []
    while ((match = snippetRegex.exec(html)) !== null) {
      snippets.push(stripTags(match[1]).trim())
    }

    for (let i = 0; i < links.length && i < maxResults; i++) {
      results.push({
        title: links[i].title,
        url: links[i].url,
        snippet: snippets[i] ?? '',
      })
    }

    return results
  }
}

// ════════════════════════════════════════════════════════════════
// 主搜索客户端
// ════════════════════════════════════════════════════════════════

export type EngineName = 'bing' | 'baidu' | 'duckduckgo'

/** 引擎注册表 */
const ENGINE_REGISTRY: Record<EngineName, () => SearchEngine> = {
  bing: () => new BingEngine(),
  baidu: () => new BaiduEngine(),
  duckduckgo: () => new DuckDuckGoEngine(),
}

export class SearchClient {
  private engines: SearchEngine[]

  /**
   * @param engineNames 启用的搜索引擎列表，按优先级排列。默认 ['bing', 'baidu']
   */
  constructor(engineNames: EngineName[] = ['bing', 'baidu']) {
    this.engines = engineNames
      .filter((name) => name in ENGINE_REGISTRY)
      .map((name) => ENGINE_REGISTRY[name]())
  }

  /**
   * 多引擎搜索
   *
   * 按优先级依次调用各引擎，只要一个引擎返回结果就停止。
   * 如果所有引擎都失败，返回空结果。
   */
  async search(query: string, maxResults: number = 8): Promise<SearchResponse> {
    if (!query.trim()) {
      return { results: [], total: 0, query }
    }

    const errors: string[] = []

    for (const engine of this.engines) {
      try {
        const results = await engine.search(query, maxResults)
        if (results.length > 0) {
          return {
            results: results.slice(0, maxResults),
            total: results.length,
            query,
          }
        }
        errors.push(`${engine.name}: 返回空结果`)
      } catch (err) {
        errors.push(`${engine.name}: ${(err as Error).message}`)
        // 继续尝试下一个引擎
      }
    }

    // 所有引擎都失败，返回空结果并附带错误信息
    console.warn('[SearchClient] 所有搜索引擎均失败:', errors.join('; '))
    return { results: [], total: 0, query }
  }

  /**
   * 获取可用引擎列表
   */
  getAvailableEngines(): EngineName[] {
    return this.engines.map((e) => e.name as EngineName)
  }

  /**
   * 抓取并提取 URL 正文内容
   */
  async fetchPage(url: string, maxChars: number = 5000): Promise<FetchedPage> {
    const html = await httpGet(url)
    const title = this.extractTitle(html)
    const content = this.extractMainContent(html).slice(0, maxChars)

    return {
      url,
      title,
      content,
      truncated: content.length >= maxChars,
    }
  }

  private extractTitle(html: string): string {
    const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
    return match ? stripTags(match[1]) : ''
  }

  private extractMainContent(html: string): string {
    let text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
      .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
      .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
      .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, '')

    const mainMatch = text.match(/<main[^>]*>([\s\S]*?)<\/main>/i)
      ?? text.match(/<article[^>]*>([\s\S]*?)<\/article>/i)

    if (mainMatch) {
      text = mainMatch[1]
    }

    return stripTags(text)
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  }
}