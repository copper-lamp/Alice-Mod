/**
 * EmbeddingModel — 嵌入向量生成封装
 *
 * 支持 OpenAI text-embedding-3-small 和 Ollama 本地模型。
 * 提供 EmbeddingStrategy 用于按记忆类型构建嵌入文本。
 */

import type { Memory, EmbeddingConfig } from './types'

// ════════════════════════════════════════════════════════════════
// 接口定义
// ════════════════════════════════════════════════════════════════

export interface IEmbeddingModel {
  /** 生成单条文本的嵌入向量 */
  embed(text: string): Promise<number[]>
  /** 批量生成文本的嵌入向量 */
  embedBatch(texts: string[]): Promise<number[][]>
  /** 获取向量维度 */
  getDimension(): number
  /** 健康检查 */
  healthCheck(): Promise<boolean>
}

// ════════════════════════════════════════════════════════════════
// EmbeddingStrategy — 按记忆类型构建嵌入文本
// ════════════════════════════════════════════════════════════════

export class EmbeddingStrategy {
  /**
   * 根据记忆类型和内容构建用于嵌入的文本
   */
  static buildEmbeddingText(memory: Memory): string {
    switch (memory.type) {
      case 'player_habit':
        return `玩家 ${memory.content.player ?? 'unknown'} 偏好 ${memory.content.preference ?? memory.content.description ?? ''}`
      case 'map_point':
        return `${memory.content.name ?? '坐标点'} 在 ${memory.content.x ?? '?'}, ${memory.content.y ?? '?'}, ${memory.content.z ?? '?'} ${memory.content.dimension ?? ''}，特征：${memory.content.description ?? ''}`
      case 'task_experience':
        return `任务 ${memory.content.task ?? 'unknown'}：${memory.content.lesson ?? memory.content.description ?? ''}`
      case 'social':
        return `与 ${memory.content.player ?? 'unknown'} 的关系：${memory.content.relation ?? memory.content.description ?? ''}`
      case 'skill':
        return `技能 ${memory.content.name ?? 'unknown'}：${memory.content.description ?? ''}`
      default:
        // 兜底：将 content 转为文本
        return Object.entries(memory.content)
          .map(([k, v]) => `${k}: ${v ?? ''}`)
          .join('，')
    }
  }

  /**
   * 批量构建嵌入文本
   */
  static buildEmbeddingTexts(memories: Memory[]): string[] {
    return memories.map(m => this.buildEmbeddingText(m))
  }
}

// ════════════════════════════════════════════════════════════════
// OpenAI Embedding Provider
// ════════════════════════════════════════════════════════════════

class OpenAIEmbeddingProvider implements IEmbeddingModel {
  private apiKey: string
  private baseUrl: string
  private model: string
  private dimension: number

  constructor(config: EmbeddingConfig) {
    this.apiKey = config.apiKey ?? ''
    this.baseUrl = config.baseUrl ?? 'https://api.openai.com/v1'
    this.model = config.model
    this.dimension = config.dimension
  }

  async embed(text: string): Promise<number[]> {
    const [result] = await this.embedBatch([text])
    return result
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return []

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000) // 5s 超时

    try {
      const response = await fetch(`${this.baseUrl}/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          input: texts,
          model: this.model,
          dimensions: this.dimension,
        }),
        signal: controller.signal,
      })

      if (!response.ok) {
        throw new Error(`OpenAI embedding API error: ${response.status} ${response.statusText}`)
      }

      const data = (await response.json()) as {
        data: Array<{ embedding: number[] }>
        usage: { total_tokens: number }
      }

      return data.data.map(item => item.embedding)
    } finally {
      clearTimeout(timeout)
    }
  }

  getDimension(): number {
    return this.dimension
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.embed('ping')
      return true
    } catch {
      return false
    }
  }
}

// ════════════════════════════════════════════════════════════════
// Ollama Embedding Provider
// ════════════════════════════════════════════════════════════════

class OllamaEmbeddingProvider implements IEmbeddingModel {
  private baseUrl: string
  private model: string
  private dimension: number

  constructor(config: EmbeddingConfig) {
    this.baseUrl = config.baseUrl ?? 'http://localhost:11434'
    this.model = config.model
    this.dimension = config.dimension
  }

  async embed(text: string): Promise<number[]> {
    const [result] = await this.embedBatch([text])
    return result
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return []

    const results: number[][] = []
    for (const text of texts) {
      const response = await fetch(`${this.baseUrl}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          prompt: text,
        }),
      })

      if (!response.ok) {
        throw new Error(`Ollama embedding API error: ${response.status} ${response.statusText}`)
      }

      const data = (await response.json()) as { embedding: number[] }
      results.push(data.embedding)
    }

    return results
  }

  getDimension(): number {
    return this.dimension
  }

  async healthCheck(): Promise<boolean> {
    try {
      // Ollama 健康检查：检查服务是否在运行
      const response = await fetch(`${this.baseUrl}/api/tags`, { method: 'GET' })
      return response.ok
    } catch {
      return false
    }
  }
}

// ════════════════════════════════════════════════════════════════
// EmbeddingModel 工厂
// ════════════════════════════════════════════════════════════════

/**
 * 创建嵌入模型实例
 */
export function createEmbeddingModel(config: EmbeddingConfig): IEmbeddingModel {
  switch (config.provider) {
    case 'openai':
      return new OpenAIEmbeddingProvider(config)
    case 'ollama':
      return new OllamaEmbeddingProvider(config)
    default:
      throw new Error(`Unsupported embedding provider: ${config.provider}`)
  }
}