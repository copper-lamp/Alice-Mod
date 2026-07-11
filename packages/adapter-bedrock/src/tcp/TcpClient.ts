/**
 * TcpClient — TCP 客户端核心
 *
 * 负责 Adapter Core BE 与 Agent Core 之间的 TCP 通信通道：
 * - 连接管理（connect/disconnect）
 * - 握手认证（hello 消息）
 * - 心跳保活（ping → pong）
 * - 断线重连（指数退避）
 * - JSON-RPC 2.0 消息收发
 * - 粘包处理
 */

import { JsonRpcCodec, JSONRPC_ERROR_CODES } from './json-rpc.js';
import type {
  JsonRpcMessage,
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcNotification,
} from './json-rpc.js';
import { FrameAccumulator } from './message-frame.js';
import { buildHelloParams, isHandshakeAccepted } from './handshake.js';
import type { HelloParams, HelloResult } from './handshake.js';
import { buildPongResponse } from './heartbeat.js';
import { ReconnectScheduler } from './reconnect.js';
// logger 为 LLSE 全局变量，无需导入

// ── 连接状态 ──

export enum ConnectionState {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  HANDSHAKING = 'handshaking',
  CONNECTED = 'connected',
  RECONNECTING = 'reconnecting',
}

// ── 配置 ──

export interface TcpClientConfig {
  host: string;
  port: number;
  authToken: string;
  instanceId: string;
  schemaVersion?: string;
  gameVersion: string;
  modVersion?: string;
  connectTimeoutMs?: number;
  requestTimeoutMs?: number;
  maxReconnectAttempts?: number;
}

// ── 内部类型 ──

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  timer: ReturnType<typeof setTimeout>;
}

// ── 默认值 ──

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 27541;
const DEFAULT_CONNECT_TIMEOUT_MS = 5000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30000;

// ── TcpClient 类 ──

export class TcpClient {
  // 配置
  private host: string;
  private port: number;
  private authToken: string;
  readonly instanceId: string;
  private schemaVersion: string;
  private gameVersion: string;
  private modVersion: string;
  private connectTimeoutMs: number;
  private requestTimeoutMs: number;

  // 内部状态
  private socket: any | null = null; // net.Socket (LLSE net 对象)
  private state: ConnectionState = ConnectionState.DISCONNECTED;
  private frameAccumulator: FrameAccumulator = new FrameAccumulator();
  private requestIdCounter: number = 0;
  private pendingRequests: Map<number, PendingRequest> = new Map();
  private reconnectScheduler: ReconnectScheduler;
  private messageHandler: ((msg: JsonRpcMessage) => void) | null = null;
  private stateChangeHandler: ((state: ConnectionState) => void) | null = null;
  private heartbeatIntervalMs: number = 10000;

  // 握手结果
  private sessionId: string = '';
  private serverVersion: string = '';

  constructor(config: TcpClientConfig) {
    this.host = config.host || DEFAULT_HOST;
    this.port = config.port || DEFAULT_PORT;
    this.authToken = config.authToken;
    this.instanceId = config.instanceId;
    this.schemaVersion = config.schemaVersion || '1.0.0';
    this.gameVersion = config.gameVersion;
    this.modVersion = config.modVersion || '1.0.0';
    this.connectTimeoutMs = config.connectTimeoutMs || DEFAULT_CONNECT_TIMEOUT_MS;
    this.requestTimeoutMs = config.requestTimeoutMs || DEFAULT_REQUEST_TIMEOUT_MS;
    this.reconnectScheduler = new ReconnectScheduler(
      config.maxReconnectAttempts || 5,
    );
  }

  // ── 生命周期 ──

  /**
   * 连接服务器 + 握手
   */
  async connect(): Promise<void> {
    if (this.state === ConnectionState.CONNECTED) return;

    this.setState(ConnectionState.CONNECTING);
    logger.info(`[TcpClient] 正在连接 ${this.host}:${this.port}...`);

    try {
      // 创建 Socket 连接
      await this.createSocket();

      // 发送握手消息
      this.setState(ConnectionState.HANDSHAKING);
      const helloParams = buildHelloParams({
        instanceId: this.instanceId,
        authToken: this.authToken,
        gameVersion: this.gameVersion,
        schemaVersion: this.schemaVersion,
        modVersion: this.modVersion,
      });

      const result = await this.sendRequest('hello', helloParams, this.connectTimeoutMs);
      this.handleHandshakeResult(result);
    } catch (err) {
      this.cleanupSocket();
      this.setState(ConnectionState.DISCONNECTED);
      throw err;
    }
  }

  /**
   * 断开连接
   */
  async disconnect(): Promise<void> {
    this.reconnectScheduler.destroy();
    this.cleanupSocket();
    this.frameAccumulator.reset();
    this.setState(ConnectionState.DISCONNECTED);
    logger.info('[TcpClient] 已断开连接');
  }

  /**
   * 获取当前连接状态
   */
  getState(): ConnectionState {
    return this.state;
  }

  /**
   * 是否已连接
   */
  isConnected(): boolean {
    return this.state === ConnectionState.CONNECTED;
  }

  /**
   * 获取会话 ID
   */
  getSessionId(): string {
    return this.sessionId;
  }

  /**
   * 获取服务器版本
   */
  getServerVersion(): string {
    return this.serverVersion;
  }

  /**
   * 获取心跳间隔
   */
  getHeartbeatIntervalMs(): number {
    return this.heartbeatIntervalMs;
  }

  // ── 消息发送 ──

  /**
   * 发送请求并等待响应
   */
  async sendRequest(method: string, params: any, timeoutMs?: number): Promise<any> {
    const id = ++this.requestIdCounter;
    const timeout = timeoutMs || this.requestTimeoutMs;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`[TcpClient] 请求超时: ${method} (${timeout}ms)`));
      }, timeout);

      this.pendingRequests.set(id, { resolve, reject, timer });

      const raw = JsonRpcCodec.encodeRequest(method, params, id);
      this.sendRaw(raw);
    });
  }

  /**
   * 发送通知（不等待响应）
   */
  sendNotification(method: string, params: any): void {
    const raw = JsonRpcCodec.encodeNotification(method, params);
    this.sendRaw(raw);
  }

  /**
   * 发送原始字符串
   */
  sendRaw(data: string): void {
    if (!this.socket) {
      logger.warn('[TcpClient] 尝试在未连接时发送消息');
      return;
    }
    try {
      this.socket.write(data);
    } catch (err) {
      logger.error(`[TcpClient] 发送消息失败: ${err}`);
    }
  }

  // ── 事件回调 ──

  onMessage(handler: (msg: JsonRpcMessage) => void): void {
    this.messageHandler = handler;
  }

  onStateChange(handler: (state: ConnectionState) => void): void {
    this.stateChangeHandler = handler;
  }

  // ── 内部方法 ──

  private setState(newState: ConnectionState): void {
    const prev = this.state;
    this.state = newState;
    logger.debug(`[TcpClient] 状态: ${prev} → ${newState}`);
    this.stateChangeHandler?.(newState);
  }

  private createSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        // LLSE 环境使用 net.connect
        // @ts-ignore — LLSE 全局 net 对象
        const sock = net.connect(this.port, this.host);

        this.socket = sock;

        const connectTimeout = setTimeout(() => {
          this.cleanupSocket();
          reject(new Error(`[TcpClient] 连接超时 (${this.connectTimeoutMs}ms)`));
        }, this.connectTimeoutMs);

        sock.on('connect', () => {
          clearTimeout(connectTimeout);
          logger.info(`[TcpClient] 已连接到 ${this.host}:${this.port}`);
          resolve();
        });

        sock.on('data', (data: Buffer) => {
          this.onData(data);
        });

        sock.on('close', () => {
          logger.warn('[TcpClient] 连接已关闭');
          this.cleanupSocket();
          this.handleDisconnect();
        });

        sock.on('error', (err: Error) => {
          logger.error(`[TcpClient] 连接错误: ${err.message}`);
          this.cleanupSocket();
          if (this.state === ConnectionState.CONNECTING) {
            reject(err);
          } else {
            this.handleDisconnect();
          }
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  private cleanupSocket(): void {
    if (this.socket) {
      try {
        this.socket.removeAllListeners();
        this.socket.destroy();
      } catch (_) {
        // ignore
      }
      this.socket = null;
    }
  }

  private onData(data: Buffer): void {
    const messages = this.frameAccumulator.feed(data);

    for (const msgStr of messages) {
      try {
        const msg = JsonRpcCodec.parse(msgStr);
        this.handleMessage(msg);
      } catch (err) {
        logger.error(`[TcpClient] 消息解析失败: ${msgStr.substring(0, 100)}`);
      }
    }
  }

  private handleMessage(msg: JsonRpcMessage): void {
    // 心跳响应 — 自动回复 pong
    if (JsonRpcCodec.isRequest(msg)) {
      const request = msg as JsonRpcRequest;
      if (request.method === 'ping') {
        const pongRaw = buildPongResponse(request.id);
        this.sendRaw(pongRaw);
        return;
      }
    }

    // 响应匹配 — 处理发送请求的响应
    if (JsonRpcCodec.isResponse(msg)) {
      const response = msg as JsonRpcResponse;
      this.handleResponse(response);
      return;
    }

    // 通知或请求 — 转发给外部处理器
    this.messageHandler?.(msg);
  }

  private handleResponse(response: JsonRpcResponse): void {
    const pending = this.pendingRequests.get(response.id as number);
    if (!pending) {
      logger.warn(`[TcpClient] 收到未知请求 ID 的响应: ${response.id}`);
      return;
    }

    clearTimeout(pending.timer);
    this.pendingRequests.delete(response.id as number);

    if (response.error) {
      pending.reject(new Error(`[${response.error.code}] ${response.error.message}`));
    } else {
      pending.resolve(response.result);
    }
  }

  private handleHandshakeResult(result: HelloResult): void {
    if (isHandshakeAccepted(result)) {
      this.sessionId = result.session_id;
      this.serverVersion = result.server_version;
      this.heartbeatIntervalMs = result.heartbeat_interval_ms || 10000;
      this.reconnectScheduler.reset();
      this.setState(ConnectionState.CONNECTED);
      logger.info(`[TcpClient] 握手成功 (session: ${this.sessionId})`);
    } else {
      const message = result.message || '认证被拒绝';
      logger.error(`[TcpClient] 握手失败: ${message}`);
      this.cleanupSocket();
      this.setState(ConnectionState.DISCONNECTED);
      throw new Error(`[TcpClient] 握手失败: ${message}`);
    }
  }

  private handleDisconnect(): void {
    // 清理待处理请求
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error('[TcpClient] 连接已断开'));
    }
    this.pendingRequests.clear();

    // 连接断开后进入重连流程
    if (this.state === ConnectionState.CONNECTED ||
        this.state === ConnectionState.CONNECTING ||
        this.state === ConnectionState.HANDSHAKING) {
      this.setState(ConnectionState.RECONNECTING);
      this.reconnectScheduler.schedule(() => {
        this.attemptReconnect();
      });
    }
  }

  private async attemptReconnect(): Promise<void> {
    logger.info('[TcpClient] 正在重连...');
    try {
      await this.connect();
      logger.info('[TcpClient] 重连成功');
    } catch (err) {
      logger.error(`[TcpClient] 重连失败: ${err}`);
    }
  }
}