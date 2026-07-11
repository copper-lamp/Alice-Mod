/**
 * 断线重连 — 指数退避
 *
 * 连接断开后按指数退避策略自动重连：
 * 1s → 2s → 4s → 8s → 16s，最多 5 次。
 * 重连成功后重置计数。
 */

// logger 为 LLSE 全局变量，无需导入

// ── 常量 ──

/** 重连间隔（毫秒）：指数退避 */
export const RECONNECT_INTERVALS = [1000, 2000, 4000, 8000, 16000];

/** 最大重连尝试次数 */
export const MAX_RECONNECT_ATTEMPTS = 5;

// ── 重连状态 ──

export interface ReconnectState {
  attempts: number;
  timer: ReturnType<typeof setTimeout> | null;
}

// ── 重连调度器 ──

export class ReconnectScheduler {
  private attempts: number = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly maxAttempts: number;
  private readonly intervals: number[];

  constructor(
    maxAttempts: number = MAX_RECONNECT_ATTEMPTS,
    intervals: number[] = RECONNECT_INTERVALS,
  ) {
    this.maxAttempts = maxAttempts;
    this.intervals = intervals;
  }

  /**
   * 获取当前重连间隔
   */
  getCurrentDelay(): number {
    const idx = Math.min(this.attempts, this.intervals.length - 1);
    return this.intervals[idx];
  }

  /**
   * 获取当前重连次数
   */
  getAttempts(): number {
    return this.attempts;
  }

  /**
   * 是否已达到最大重连次数
   */
  isMaxReached(): boolean {
    return this.attempts >= this.maxAttempts;
  }

  /**
   * 增加重连计数
   */
  increment(): void {
    this.attempts++;
  }

  /**
   * 重置重连计数
   */
  reset(): void {
    this.attempts = 0;
    this.clearTimer();
  }

  /**
   * 调度下一次重连
   * @param callback 重连回调
   * @returns 延迟时间（毫秒），-1 表示不重连
   */
  schedule(callback: () => void): number {
    if (this.isMaxReached()) {
      logger.error(`[Reconnect] 已达最大重连次数 (${this.maxAttempts})，停止重连`);
      return -1;
    }

    this.clearTimer();

    const delay = this.getCurrentDelay();
    this.attempts++;

    logger.info(`[Reconnect] 将在 ${delay}ms 后重连 (第 ${this.attempts} 次)`);
    this.timer = setTimeout(callback, delay);

    return delay;
  }

  /**
   * 取消当前重连定时器
   */
  clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /**
   * 销毁调度器
   */
  destroy(): void {
    this.clearTimer();
    this.attempts = 0;
  }
}