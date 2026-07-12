/**
 * TcpClient — TCP 客户端核心
 *
 * 负责 Adapter Core BE 与 Agent Core 之间的 TCP 通信通道：
 * - 连接管理（connect/disconnect）
 * - 握手认证（handshake 消息，匹配 AC 实现）
 * - 心跳保活（ping 通知 → pong 通知）
 * - 断线重连（指数退避，包括初始连接失败的重试）
 * - JSON-RPC 2.0 消息收发
 * - 粘包处理
 *
 * ⚠ 关于 handleDisconnect 被重复调用：
 *   在 Windows 上，socket ECONNREFUSED 时，'error' 和 'close'
 *   事件会先后触发。用 _handlingError 标志防止重复处理。
 */

import { JsonRpcCodec } from './json-rpc.js';
import type {
  JsonRpcMessage,
  JsonRpcRequest,
  JsonRpcResponse,
} from './json-rpc.js';
import { FrameAccumulator } from './message-frame.js';
import { buildHelloParams, isHandshakeAccepted, HANDSHAKE_METHOD } from './handshake.js';
import type { HelloResult } from './handshake.js';
import { buildPongResponse, isPingNotification } from './heartbeat.js';
import { ReconnectScheduler } from './reconnect.js';
import * as net from 'net';
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
  /** 游戏版本号，如 "1.21.0" */
  gameVersion: string;
  gameEdition?: 'bedrock' | 'java';
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
  private gameEdition: 'bedrock' | 'java';
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

  /**
   * 防止 error + close 双重处理
   * Windows 上 socket 连接失败时，'error' 和 'close' 事件先后触发，
   * close handler 通过此标志跳过已由 error handler 处理的场景。
   */
  private _handlingError: boolean = false;

  constructor(config: TcpClientConfig) {
    this.host = config.host || DEFAULT_HOST;
    this.port = config.port || DEFAULT_PORT;
    this.authToken = config.authToken;
    this.instanceId = config.instanceId;
    this.schemaVersion = config.schemaVersion || '1.0.0';
    this.gameVersion = config.gameVersion;
    this.gameEdition = config.gameEdition || 'bedrock';
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
   * 使用 "handshake" method（适配 AC 的实现）
   *
   * 注意：初始连接失败也会通过 handleDisconnect 进入重连，
   * 以应对 AC 服务端尚未就绪的场景。
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
        schemaVersion: this.schemaVersion,
        gameEdition: this.gameEdition,
        modVersion: this.modVersion,
      });

      // AC 期望 method 为 "handshake"
      const result = await this.sendRequest(HANDSHAKE_METHOD, helloParams, this.connectTimeoutMs);
      this.handleHandshakeResult(result);
    } catch (err) {
      this.cleanupSocket();
      this.setState(ConnectionState.DISCONNECTED);
      // 连接失败（无论是否曾经连接过都触发重连）
      this.enterReconnect();
      throw err;
    }
  }

  /**
   * 断开连接
   */
  async disconnect(): Promise<void> {
    this.reconnectScheduler.destroy();
    this._handlingError = false;
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
   * 获取会话标识（握手成功后由 AC 设置，后续使用）
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
        // LSE NodeJS 使用 require('net')
        const sock = net.connect(this.port, this.host);

        this.socket = sock;

        const connectTimeout = setTimeout(() => {
          this._handlingError = true;
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
          // Windows 上 error + close 双发保护
          if (this._handlingError) {
            this._handlingError = false;
            return;
          }
          this.cleanupSocket();
          this.handleDisconnect();
        });

        sock.on('error', (err: Error) => {
          logger.error(`[TcpClient] 连接错误: ${err.message}`);
          this._handlingError = true;
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
    // ── 心跳处理 — AC 可能以 request 或 notification 格式发送 ping ──

    // 情况 1: ping 作为 request（含 id）
    if (JsonRpcCodec.isRequest(msg)) {
      const request = msg as JsonRpcRequest;
      if (request.method === 'ping') {
        const pongRaw = buildPongResponse();
        this.sendRaw(pongRaw);
        return;
      }
    }

    // 情况 2: ping 作为 notification（无 id — AC 的实际实现）
    if (isPingNotification(msg)) {
      const pongRaw = buildPongResponse();
      this.sendRaw(pongRaw);
      return;
    }

    // ── 响应匹配 — 处理发送请求的响应 ──
    if (JsonRpcCodec.isResponse(msg)) {
      const response = msg as JsonRpcResponse;
      this.handleResponse(response);
      return;
    }

    // ── 通知或请求 — 转发给外部处理器 ──
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

  /**
   * 处理握手结果（适配 AC 的实现）
   *
   * AC 返回格式：
   * {
   *   success: true,
   *   version: "1.0.0",
   *   server_name: "Alice Mod Agent Core",
   *   max_tools: 43
   * }
   */
  private handleHandshakeResult(result: HelloResult): void {
    if (isHandshakeAccepted(result)) {
      this.sessionId = result.server_name || '';
      this.serverVersion = result.version || '';
      this.heartbeatIntervalMs = 10000; // 固定 10s，符合协议规范
      this.reconnectScheduler.reset();
      this.setState(ConnectionState.CONNECTED);
      logger.info(`[TcpClient] 握手成功 (server: ${result.server_name}, v${result.version})`);
    } else {
      const message = '认证被拒绝';
      logger.error(`[TcpClient] 握手失败: ${message}`);
      this.cleanupSocket();
      this.setState(ConnectionState.DISCONNECTED);
      throw new Error(`[TcpClient] 握手失败: ${message}`);
    }
  }

  /**
   * 连接断开处理 — 进入重连
   *
   * 注意：此方法可能从多个入口被调用（close 事件、error 事件、
   * connect() catch），需要确保不被重复调用。
   */
  private handleDisconnect(): void {
    // 清理待处理请求
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error('[TcpClient] 连接已断开'));
    }
    this.pendingRequests.clear();

    this.enterReconnect();
  }

  /**
   * 进入重连流程
   * 无论是否曾经连接成功，都会尝试重连（应对 AC 尚未启动的场景）。
   * 仅当已在重连中时跳过，防止重复调度。
   */
  private enterReconnect(): void {
    if (this.state === ConnectionState.RECONNECTING) {
      return;
    }
    this.setState(ConnectionState.RECONNECTING);
    this.reconnectScheduler.schedule(() => {
      this.attemptReconnect();
    });
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
