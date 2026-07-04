/**
 * 心跳管理模块
 *
 * 协议规范：
 * - AC 作为服务端定时发送 Ping 请求（默认 10s 间隔）
 * - Adapter Core 回复 Pong 响应
 * - 30s 内未收到 Pong 则判定超时断开
 * - 失败后在 1s/2s/4s/8s/16s 指数退避重试，最多 5 次
 */

/** 心跳状态 */
export enum HeartbeatState {
  Idle = 'idle',
  Waiting = 'waiting',       // 已发送 Ping，等待 Pong
  Failed = 'failed',         // 超时未收到 Pong
  Stopped = 'stopped',
}

/** 心跳事件 */
export enum HeartbeatEvent {
  PongReceived = 'pong',
  Timeout = 'timeout',
  Failed = 'failed',
  Restored = 'restored',
}

/** 心跳配置 */
export interface HeartbeatOptions {
  /** Ping 发送间隔（ms） */
  interval: number;
  /** 超时时间（ms） */
  timeout: number;
  /** 最大失败次数后触发断开 */
  maxFailures: number;
}

/** 默认心跳配置 */
export const DEFAULT_HEARTBEAT_OPTIONS: HeartbeatOptions = {
  interval: 10000,
  timeout: 30000,
  maxFailures: 5,
};

/** 心跳回调 */
export type HeartbeatCallback = (event: HeartbeatEvent, data?: unknown) => void;

/**
 * 心跳管理器
 *
 * 管理单个连接的心跳生命周期：
 * - 定时发送 Ping
 * - 监控 Pong 回复
 * - 超时检测
 * - 失败计数 + 断线通知
 */
export class HeartbeatManager {
  private state: HeartbeatState = HeartbeatState.Idle;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private timeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private failureCount = 0;
  private lastPongTime = 0;
  private readonly options: HeartbeatOptions;
  private readonly onEvent: HeartbeatCallback;

  constructor(options: Partial<HeartbeatOptions> = {}, onEvent: HeartbeatCallback) {
    this.options = { ...DEFAULT_HEARTBEAT_OPTIONS, ...options };
    this.onEvent = onEvent;
  }

  /** 当前状态 */
  get currentState(): HeartbeatState {
    return this.state;
  }

  /** 失败次数 */
  get currentFailures(): number {
    return this.failureCount;
  }

  /** 上次 Pong 时间 */
  get lastPong(): number {
    return this.lastPongTime;
  }

  /** 是否健康 */
  get isHealthy(): boolean {
    return this.state === HeartbeatState.Idle;
  }

  /**
   * 启动心跳（开始定时发送 Ping）
   *
   * @param sendPing - 发送 Ping 的函数
   */
  start(sendPing: () => void): void {
    if (this.pingTimer !== null) return;

    this.state = HeartbeatState.Idle;
    this.failureCount = 0;

    // 立即发送一次
    this.sendPing(sendPing);

    // 定时发送
    this.pingTimer = setInterval(() => {
      this.sendPing(sendPing);
    }, this.options.interval);
  }

  /**
   * 收到 Pong 响应
   */
  receivePong(): void {
    this.lastPongTime = Date.now();
    this.failureCount = 0;
    this.clearTimeout();

    if (this.state === HeartbeatState.Failed) {
      this.state = HeartbeatState.Idle;
      this.onEvent(HeartbeatEvent.Restored);
    }

    this.state = HeartbeatState.Idle;
    this.onEvent(HeartbeatEvent.PongReceived);
  }

  /**
   * 停止心跳
   */
  stop(): void {
    this.state = HeartbeatState.Stopped;
    this.clearPingTimer();
    this.clearTimeout();
    this.failureCount = 0;
  }

  /** 重置计数器 */
  reset(): void {
    this.failureCount = 0;
    this.state = HeartbeatState.Idle;
  }

  // ── 内部方法 ──

  private sendPing(sendPing: () => void): void {
    if (this.state === HeartbeatState.Stopped) return;

    this.state = HeartbeatState.Waiting;
    sendPing();

    // 启动超时计时器
    this.clearTimeout();
    this.timeoutTimer = setTimeout(() => {
      this.handleTimeout();
    }, this.options.timeout);
  }

  private handleTimeout(): void {
    this.failureCount++;
    this.state = HeartbeatState.Failed;
    this.onEvent(HeartbeatEvent.Timeout, { failureCount: this.failureCount });

    if (this.failureCount >= this.options.maxFailures) {
      this.state = HeartbeatState.Failed;
      this.onEvent(HeartbeatEvent.Failed, { failureCount: this.failureCount });
    }
  }

  private clearPingTimer(): void {
    if (this.pingTimer !== null) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private clearTimeout(): void {
    if (this.timeoutTimer !== null) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = null;
    }
  }
}
