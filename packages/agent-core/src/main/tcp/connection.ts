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

/** 连接事件 */
export enum ConnectionEvent {
  Message = 'message',
  Request = 'request',
  Response = 'response',
  Notification = 'notification',
  StateChange = 'state-change',
  Closed = 'closed',
  Error = 'error',
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

  private _state: ConnectionState = ConnectionState.Disconnected;
  private readonly socket: Socket;
  private readonly frameAccumulator = new FrameAccumulator();
  private heartbeat: HeartbeatManager;
  private handshake: HandshakeHandler;
  private messageHandler: MessageHandler | null = null;
  private readonly connectedAt: number;
  private lastActivity: number;

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

  private handleResponse(_response: JsonRpcResponse): void {
    this.emit(ConnectionEvent.Response, _response);
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
