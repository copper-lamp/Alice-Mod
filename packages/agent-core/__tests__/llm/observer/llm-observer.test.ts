/**
 * LLM Observer 单例与观测功能测试
 *
 * 覆盖场景：
 * - DefaultLLMObserver 基本 record / query / export / getStats
 * - getLLMObserver / setLLMObserver / resetLLMObserver 全局单例行为
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  DefaultLLMObserver,
  getLLMObserver,
  setLLMObserver,
  resetLLMObserver,
} from '../../../src/main/llm/observer/llm-observer'

describe('DefaultLLMObserver', () => {
  it('应记录并查询调用记录', () => {
    const observer = new DefaultLLMObserver()
    observer.record({
      requestId: 'r1',
      providerId: 'openai',
      model: 'gpt-4o',
      promptTokens: 10,
      completionTokens: 20,
      totalTokens: 30,
      durationMs: 100,
      success: true,
      finishReason: 'stop',
      timestamp: Date.now(),
    })

    expect(observer.recordCount).toBe(1)
    expect(observer.export()).toHaveLength(1)
  })

  it('wrap 应在成功调用后自动记录', async () => {
    const observer = new DefaultLLMObserver()
    const result = await observer.wrap('openai', 'gpt-4o', async () => ({
      message: { role: 'assistant', content: 'ok' },
      usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
      finishReason: 'stop',
    }))

    expect(result).toBeDefined()
    expect(observer.recordCount).toBe(1)
  })

  it('wrap 应在失败调用后记录失败记录并抛出异常', async () => {
    const observer = new DefaultLLMObserver()
    const error = new Error('mock error')
    await expect(
      observer.wrap('openai', 'gpt-4o', async () => {
        throw error
      }),
    ).rejects.toThrow('mock error')

    expect(observer.recordCount).toBe(1)
    const record = observer.export()[0]!
    expect(record.success).toBe(false)
    expect(record.totalTokens).toBe(0)
  })

  it('应支持调用监听器', () => {
    const observer = new DefaultLLMObserver()
    const listener = vi.fn()
    observer.onCallRecorded(listener)

    observer.record({
      requestId: 'r1',
      providerId: 'openai',
      model: 'gpt-4o',
      promptTokens: 1,
      completionTokens: 1,
      totalTokens: 2,
      durationMs: 10,
      success: true,
      finishReason: 'stop',
      timestamp: Date.now(),
    })

    expect(listener).toHaveBeenCalledTimes(1)
  })
})

describe('LLM Observer 全局单例', () => {
  beforeEach(() => {
    resetLLMObserver()
  })

  it('getLLMObserver 应返回同一实例', () => {
    const a = getLLMObserver()
    const b = getLLMObserver()
    expect(a).toBe(b)
  })

  it('setLLMObserver 应替换全局实例', () => {
    const custom = new DefaultLLMObserver()
    setLLMObserver(custom)
    expect(getLLMObserver()).toBe(custom)
  })

  it('resetLLMObserver 后再次 get 应创建新实例', () => {
    const a = getLLMObserver()
    resetLLMObserver()
    const b = getLLMObserver()
    expect(a).not.toBe(b)
  })
})
