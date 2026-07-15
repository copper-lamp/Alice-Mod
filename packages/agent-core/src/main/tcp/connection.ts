/**
 * 单个连接管理模块
 *
 * 封装一个 TCP Socket 连接，集成：
 * - 帧解码（粘包处理）
 * - 消息分发（Request / Response / Notification）
 * - 握手状态管理
 * - 心跳管理
 * - 状态变更通知
 */

import { EventEmitter } from 'node:events';
import type { Socket } from 'node:net';
import crypto from 'node:crypto';

import type { JsonRpcRequest, JsonRpcResponse, JsonRpcNotification } from '@mcagent/shared';

import { FrameAccumulator } from './frame';
import { encodeFrame } from './frame';
import { createNotification } from './codec';
import { parseMessage, isRequest, isResponse, isNotification } from './codec';
import { HeartbeatManager, HeartbeatEvent, type HeartbeatOptions } from './heartbeat';
import { HandshakeHandler } from './handshake';
import type { ClientVersion } from './types';
import { ConnectionState } from './types';
import { AbortError, TimeoutError } from './errors';

/** 连接事件 */
export enum ConnectionEvent {
  Message = 'message',
  Request = 'request',
  Response = 'response',
  Notification = 'notification',
  StateChange = 'state-change',
  Closed = 'closed',
  Error = 'error',
  WorldOnline = 'world:online',       // 世界上线通知
  WorldOffline = 'world:offline',     // 世界下线通知
  /** V20：收到未匹配 pendingRequests 的响应（孤儿响应） */
  OrphanResponse = 'tcp:orphan-response',
}

/**
 * V20 §4.3 — 待处理的 server→client JSON-RPC Request。
 *
 * 由 sendRequestAndAwait 注册，handleResponse 反查并 resolve/reject。
 * 连接关闭时 handleClosed 统一 reject 全部 pending。
 */
export interface PendingRequest {
  resolve: (resp: JsonRpcResponse) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  method: string;
  /** abort 监听器（用于清理） */
  onAbort?: () => void;
  /** 注册时的 AbortSignal（用于清理） */
  signal?: AbortSignal;
}

/** 消息处理器 */
export interface MessageHandler {
  onRequest?: (clientId: string, request: JsonRpcRequest) => Promise<JsonRpcResponse | null>;
  onNotification?: (clientId: string, notification: JsonRpcNotification) => void;
}

/**
 * TCP 连接封装
 *
 * 管理单个 Socket 的完整生命周期
 */
export class TcpConnection extends EventEmitter {
  public readonly id: string;
  public readonly address: string;
  public instanceId: string | null = null;
  public version: ClientVersion | null = null;
  public toolCount = 0;

  /** 当前世界名称（v2 握手扩展），无世界上下文时为 null */
  public worldName: string | null = null;
  /** 当前世界是否在线（v2 握手扩展） */
  public worldOnline: boolean = true;

  private _state: ConnectionState = ConnectionState.Disconnected;
  private readonly socket: Socket;
  private readonly frameAccumulator = new FrameAccumulator();
  private heartbeat: HeartbeatManager;
  private handshake: HandshakeHandler;
  private messageHandler: MessageHandler | null = null;
  private readonly connectedAt: number;
  private lastActivity: number;

  /** V20 §4.3：pending server→client 请求（id → PendingRequest） */
  private readonly pendingRequests = new Map<string | number, PendingRequest>();
  /** V20 §4.3：自增 request id 序列（Agent Core 作为 Server 发起的 Request） */
  private requestIdSeq = 0;

  constructor(
    socket: Socket,
    validTokens: Set<string>,
    heartbeatOptions: Partial<HeartbeatOptions> = {},
  ) {
    super();

    this.id = crypto.randomUUID();
    this.socket = socket;
    this.address = `${socket.remoteAddress ?? 'unknown'}:${socket.remotePort ?? 0}`;
    this.connectedAt = Date.now();
    this.lastActivity = Date.now();

    this.handshake = new HandshakeHandler(validTokens);
    this.heartbeat = new HeartbeatManager(heartbeatOptions, (event, data) => {
      this.handleHeartbeatEvent(event, data);
    });

    this.setupSocketListeners();
    this.transitionTo(ConnectionState.Connecting);
  }

  // ── Public API ──

  /** 当前连接状态 */
  get state(): ConnectionState {
    return this._state;
  }

  /** 是否已完全连接（握手完成） */
  get isConnected(): boolean {
    return this._state === ConnectionState.Connected;
  }

  /** 连接时长（ms） */
  get uptime(): number {
    return Date.now() - this.connectedAt;
  }

  /** 最后活跃时间 */
  get lastActive(): number {
    return this.lastActivity;
  }

  /** 设置消息处理器 */
  setHandler(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  /**
   * 发送消息
   *
   * @param message - JSON 字符串
   */
  send(message: string): void {
    if (this.socket.destroyed) return;
    try {
      this.socket.write(encodeFrame(message));
    } catch (err) {
      this.emit(ConnectionEvent.Error, err);
    }
  }

  /**
   * 发送 JSON 对象
   */
  sendJson(obj: unknown): void {
    this.send(JSON.stringify(obj));
  }

  /**
   * V20 §4.3 — 主动向已连入的 Adapter Core 发 JSON-RPC Request 并等待 Response。
   *
   * 用途：tool_call / tool_call_batch / ping（带 id 形式）等 server→client 场景。
   *
   * 实现要点：
   * - 自增 id 注册到 pendingRequests
   * - 设置超时定时器 → 超时抛 TimeoutError
   * - 监听 AbortSignal → 抛 AbortError
   * - handleResponse 收到对应 id 的响应时 resolve/reject
   * - handleClosed 时统一 reject 全部 pending
   *
   * @throws NotConnectedError 连接未就绪（由调用方包装或 isConnected 检查）
   * @throws TimeoutError 超时
   * @throws AbortError 被 AbortSignal 触发
   */
  async sendRequestAndAwait(
    method: string,
    params: unknown,
    opts: { timeoutMs?: number; signal?: AbortSignal } = {},
  ): Promise<JsonRpcResponse> {
    // 1. 连接就绪检查（握手完成）
    if (this._state !== ConnectionState.Connected) {
      throw new Error(`[TcpConnection] cannot send '${method}': connection not ready (state=${this._state})`);
    }

    // 2. 检查 abort（写之前）
    if (opts.signal?.aborted) {
      throw new AbortError(`[TcpConnection] request aborted before send: ${method}`);
    }

    // 3. 分配 id 并构造 Request
    const id = ++this.requestIdSeq;
    const req: JsonRpcRequest = { jsonrpc: '2.0', id, method, params };
    const timeoutMs = opts.timeoutMs ?? 30_000;

    // 4. 注册 pending 并发请求（异步 + Promise 模式）
    return new Promise<JsonRpcResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        if (opts.signal) opts.signal.removeEventListener('abort', onAbort);
        reject(new TimeoutError(`[TcpConnection] request timeout: ${method} (${timeoutMs}ms)`));
      }, timeoutMs);

      const onAbort = () => {
        clearTimeout(timer);
        this.pendingRequests.delete(id);
        reject(new AbortError(`[TcpConnection] request aborted: ${method}`));
      };
      opts.signal?.addEventListener('abort', onAbort, { once: true });

      this.pendingRequests.set(id, { resolve, reject, timer, method, onAbort, signal: opts.signal });

      // 5. 发送（同步写 socket）
      try {
        this.sendJson(req);
      } catch (err) {
        // sendJson 内部已 emit Error，这里只需清理 pending
        clearTimeout(timer);
        this.pendingRequests.delete(id);
        if (opts.signal) opts.signal.removeEventListener('abort', onAbort);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  /**
   * 发送 Ping 心跳
   */
  sendPing(): void {
    this.sendJson(createNotification('ping'));
  }

  /**
   * 发送 Pong 响应
   */
  sendPong(id: string | number): void {
    this.sendJson({ jsonrpc: '2.0', id, result: { success: true } });
  }

  /**
   * 处理收到 Pong 响应
   */
  receivePong(): void {
    this.heartbeat.receivePong();
  }

  /**
   * 更新最后活跃时间
   */
  touch(): void {
    this.lastActivity = Date.now();
  }

  /**
   * 关闭连接
   */
  close(): void {
    this.heartbeat.stop();
    if (!this.socket.destroyed) {
      this.socket.end();
      this.socket.destroy();
    }
    this.transitionTo(ConnectionState.Disconnected);
  }

  /**
   * 获取客户端信息
   */
  getClientInfo() {
    return {
      id: this.id,
      address: this.address,
      instanceId: this.instanceId ?? 'unknown',
      state: this._state,
      version: this.version,
      connectedAt: this.connectedAt,
      lastActivity: this.lastActivity,
      toolCount: this.toolCount,
    };
  }

  // ── 内部方法 ──

  private setupSocketListeners(): void {
    this.socket.on('data', (data: Buffer) => {
      this.handleData(data);
    });

    this.socket.on('close', () => {
      this.handleClosed();
    });

    this.socket.on('error', (err: Error) => {
      this.emit(ConnectionEvent.Error, err);
    });
  }

  private handleData(data: Buffer): void {
    this.lastActivity = Date.now();
    const messages = this.frameAccumulator.feed(data);

    for (const message of messages) {
      this.dispatchMessage(message);
    }
  }

  private dispatchMessage(json: string): void {
    this.emit(ConnectionEvent.Message, json);

    try {
      const msg = parseMessage(json);

      if (isRequest(msg)) {
        this.handleRequest(msg);
      } else if (isResponse(msg)) {
        this.handleResponse(msg);
      } else if (isNotification(msg)) {
        this.handleNotification(msg);
      }
    } catch {
      // JSON 解析失败，忽略无效消息
    }
  }

  private async handleRequest(request: JsonRpcRequest): Promise<void> {
    // 特殊处理：handshake 和 pong
    if (request.method === 'handshake') {
      const result = this.handshake.validate(request.params);
      if (result.response) {
        // 使用请求的 ID 而非 null，确保客户端能匹配到待处理请求
        result.response.id = request.id;
        this.sendJson(result.response);
      }
      if (result.valid && result.instanceId) {
        this.instanceId = result.instanceId;

        // 解析 v2 握手扩展字段
        const params = request.params as Record<string, unknown> | undefined;
        if (params) {
          this.worldName = typeof params.world_name === 'string' ? params.world_name : null;
          this.worldOnline = typeof params.world_online === 'boolean' ? params.world_online : true;
        }

        this.transitionTo(ConnectionState.Connected);
        this.heartbeat.start(() => this.sendPing());
      }
      return;
    }

    if (request.method === 'pong') {
      this.receivePong();
      return;
    }

    // 未握手完成前的请求全部拒绝
    if (this._state !== ConnectionState.Connected) {
      this.sendJson({
        jsonrpc: '2.0',
        id: request.id,
        error: { code: -32002, message: 'Not authenticated' },
      });
      return;
    }

    // 委托给外部处理器
    if (this.messageHandler?.onRequest) {
      try {
        const response = await this.messageHandler.onRequest(this.id, request);
        if (response) {
          this.sendJson(response);
        }
      } catch (err) {
        this.sendJson({
          jsonrpc: '2.0',
          id: request.id,
          error: {
            code: -32603,
            message: err instanceof Error ? err.message : 'Internal error',
          },
        });
      }
    }
  }

  private handleResponse(response: JsonRpcResponse): void {
    this.lastActivity = Date.now();

    // V20 §4.3：反查 pendingRequests，匹配则 resolve/reject
    const pending = this.pendingRequests.get(response.id as string | number);
    if (pending) {
      clearTimeout(pending.timer);
      if (pending.signal && pending.onAbort) {
        pending.signal.removeEventListener('abort', pending.onAbort);
      }
      this.pendingRequests.delete(response.id as string | number);
      if ('error' in response && response.error) {
        pending.reject(new Error(`[${response.error.code}] ${response.error.message}`));
      } else {
        pending.resolve(response);
      }
      return;
    }

    // 兜底：未知 id 的响应（可能是迟到的响应或对端自发响应）
    this.emit(ConnectionEvent.Response, response);
    this.emit(ConnectionEvent.OrphanResponse, response);
  }

  private handleNotification(notification: JsonRpcNotification): void {
    // 特殊处理 pong 通知（兼容 pong 作为通知发送）
    if (notification.method === 'pong') {
      this.receivePong();
      return;
    }

    if (notification.method === 'register_tools') {
      const params = notification.params as { tools?: unknown[] } | undefined;
      if (params?.tools) {
        this.toolCount = params.tools.length;
      }
    }

    // 世界上下文通知
    if (notification.method === 'world_online') {
      const params = notification.params as Record<string, unknown> | undefined;
      if (params) {
        this.worldName = typeof params.world_name === 'string' ? params.world_name : this.worldName;
        this.worldOnline = true;
        this.emit(ConnectionEvent.WorldOnline, {
          instanceId: this.instanceId,
          worldName: params.world_name,
          botCount: typeof params.bot_count === 'number' ? params.bot_count : 0,
        });
      }
      return;
    }

    if (notification.method === 'world_offline') {
      const params = notification.params as Record<string, unknown> | undefined;
      if (params) {
        this.worldOnline = false;
        this.emit(ConnectionEvent.WorldOffline, {
          instanceId: this.instanceId,
          worldName: params.world_name,
          uptimeSeconds: typeof params.uptime_seconds === 'number' ? params.uptime_seconds : 0,
          botCount: typeof params.bot_count === 'number' ? params.bot_count : 0,
          reason: typeof params.reason === 'string' ? params.reason : undefined,
        });
      }
      return;
    }

    this.emit(ConnectionEvent.Notification, notification);
    this.messageHandler?.onNotification?.(this.id, notification);
  }

  private handleHeartbeatEvent(event: HeartbeatEvent, data?: unknown): void {
    switch (event) {
      case HeartbeatEvent.Timeout:
        this.emit(ConnectionEvent.Error, new Error(`Heartbeat timeout (attempt ${(data as { failureCount: number })?.failureCount ?? '?'})`));
        break;
      case HeartbeatEvent.Failed:
        this.emit(ConnectionEvent.Error, new Error('Heartbeat failed, closing connection'));
        this.close();
        break;
    }
  }

  private handleClosed(): void {
    this.heartbeat.stop();

    // V20 §4.3：清理所有 pending 请求，避免调用方永久挂起
    for (const [, p] of this.pendingRequests) {
      clearTimeout(p.timer);
      if (p.signal && p.onAbort) {
        p.signal.removeEventListener('abort', p.onAbort);
      }
      p.reject(new Error(`[TcpConnection] connection closed (method=${p.method})`));
    }
    this.pendingRequests.clear();

    this.transitionTo(ConnectionState.Disconnected);
    this.emit(ConnectionEvent.Closed);
  }

  private transitionTo(newState: ConnectionState): void {
    const prevState = this._state;
    if (prevState === newState) return;
    this._state = newState;
    this.emit(ConnectionEvent.StateChange, this.id, newState, prevState);
  }
}
