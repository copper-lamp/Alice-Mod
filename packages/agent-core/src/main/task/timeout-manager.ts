/**
 * TimeoutManager — 超时管理
 *
 * 管理任务超时定时器，支持注册、取消、刷新。
 * 超时后自动触发回调函数，并发送中止信号。
 */

import { randomUUID } from 'node:crypto'

// ════════════════════════════════════════════════════════════════
// 超时条目
// ════════════════════════════════════════════════════════════════

interface TimeoutEntry {
  taskId: string
  timer: ReturnType<typeof setTimeout>
  abortController: AbortController
  expiresAt: number
}

// ════════════════════════════════════════════════════════════════
// TimeoutManager 类
// ════════════════════════════════════════════════════════════════

export class TimeoutManager {
  private timeouts: Map<string, TimeoutEntry> = new Map()

  /**
   * 注册超时定时器
   * @param taskId 任务 ID
   * @param timeoutSec 超时时间（秒）
   * @param onTimeout 超时回调
   */
  register(taskId: string, timeoutSec: number, onTimeout: () => void): AbortSignal {
    // 先取消已有的超时
    this.unregister(taskId)

    const abortController = new AbortController()
    const now = Date.now()
    const timeoutMs = timeoutSec * 1000

    const timer = setTimeout(() => {
      this.timeouts.delete(taskId)
      abortController.abort()
      onTimeout()
    }, timeoutMs)

    this.timeouts.set(taskId, {
      taskId,
      timer,
      abortController,
      expiresAt: now + timeoutMs,
    })

    return abortController.signal
  }

  /**
   * 取消超时定时器
   */
  unregister(taskId: string): void {
    const entry = this.timeouts.get(taskId)
    if (entry) {
      clearTimeout(entry.timer)
      this.timeouts.delete(taskId)
    }
  }

  /**
   * 刷新超时（重新计时）
   */
  refresh(taskId: string, timeoutSec: number, onTimeout: () => void): AbortSignal {
    this.unregister(taskId)
    return this.register(taskId, timeoutSec, onTimeout)
  }

  /**
   * 获取任务的中止信号
   */
  getAbortSignal(taskId: string): AbortSignal | undefined {
    const entry = this.timeouts.get(taskId)
    return entry?.abortController.signal
  }

  /**
   * 检查任务是否已超时
   */
  isExpired(taskId: string): boolean {
    const entry = this.timeouts.get(taskId)
    if (!entry) return false
    return Date.now() >= entry.expiresAt
  }

  /**
   * 获取剩余时间（ms）
   */
  getRemainingMs(taskId: string): number {
    const entry = this.timeouts.get(taskId)
    if (!entry) return -1
    return Math.max(0, entry.expiresAt - Date.now())
  }

  /**
   * 获取所有活跃的超时数量
   */
  get activeCount(): number {
    return this.timeouts.size
  }

  /**
   * 清理所有超时
   */
  clearAll(): void {
    for (const [taskId, entry] of this.timeouts.entries()) {
      clearTimeout(entry.timer)
      this.timeouts.delete(taskId)
    }
  }

  /**
   * 生成一个唯一的超时 ID（用于需要独立 ID 的场景）
   */
  generateId(): string {
    return randomUUID()
  }
}