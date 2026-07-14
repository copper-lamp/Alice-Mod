/**
 * TCP 服务端
 *
 * Agent Core 的 TCP 服务端，负责监听端口、管理连接池、
 * 处理断线重连、提供连接事件通知。
 */

import { EventEmitter } from 'node:events';
import net from 'node:net';
import type { Socket } from 'node:net';

import type { JsonRpcRequest, JsonRpcNotification } from '@mcagent/shared';

import { TcpConnection, ConnectionEvent, type MessageHandler } from './connection';
import { TcpEventType, type TcpServerOptions, type TcpEventData, type TcpClientInfo, DEFAULT_AUTH_TOKEN } from './types';

/** 服务端事件 */
export enum ServerEvent {
  Listening = 'listening',
  Closed = 'closed',
  Error = 'error',
  ConnectionOpened = 'connection:opened',
  ConnectionClosed = 'connection:closed',
  ConnectionStateChange = 'connection:state-change',
  ConnectionError = 'connection:error',
  RequestReceived = 'request:received',
  NotificationReceived = 'notification:received',
  WorldOnline = 'world:online',         // 世界上线通知
  WorldOffline = 'world:offline',       // 世界下线通知
}

/**
 * TCP 服务端
 *
 * 管理多个 Adapter Core 连接的生命周期
 */
export class TcpServer extends EventEmitter {
  private server: net.Server | null = null;
  private readonly connections: Map<string, TcpConnection> = new Map();
  private readonly options: TcpServerOptions;
  private messageHandlerFactory: ((connectionId: string) => MessageHandler) | null = null;
  private listening = false;

  private readonly validTokens: Set<string>;

  constructor(options: Partial<TcpServerOptions> = {}) {
    super();
    this.options = {
      host: '0.0.0.0',
      port: 27541,
      maxConnections: 10,
      heartbeatInterval: 10000,
      heartbeatTimeout: 30000,
      ...options,
    };
    this.validTokens = options.authTokens ?? new Set([DEFAULT_AUTH_TOKEN]);
  }

  // ── Public API ──

  /** 是否正在监听 */
  get isListening(): boolean {
    return this.listening;
  }

  /** 当前连接数 */
  get connectionCount(): number {
    return this.connections.size;
  }

  /** 获取所有客户端信息 */
  getClients(): TcpClientInfo[] {
    return Array.from(this.connections.values()).map((conn) => conn.getClientInfo());
  }

  /** 按 ID 获取连接 */
  getConnection(id: string): TcpConnection | undefined {
    return this.connections.get(id);
  }

  /** 按 instanceId 查找连接 */
  findByInstanceId(instanceId: string): TcpConnection | undefined {
    for (const conn of this.connections.values()) {
      if (conn.instanceId === instanceId) return conn;
    }
    return undefined;
  }

  /**
   * 启动服务端
   */
  async start(): Promise<void> {
    if (this.server) {
      throw new Error('Server already started');
    }

    return new Promise<void>((resolve) => {
      this.server = net.createServer((socket) => {
        this.handleNewConnection(socket);
      });

      this.server.on('error', (err: Error) => {
        this.emit(ServerEvent.Error, err);
        this.emitEvent(TcpEventType.ServerError, { error: err.message });
      });

      this.server.on('close', () => {
        this.listening = false;
        this.emit(ServerEvent.Closed);
        this.emitEvent(TcpEventType.ServerClosed);
      });

      this.server.listen(this.options.port, this.options.host, () => {
        this.listening = true;
        this.emit(ServerEvent.Listening, { host: this.options.host, port: this.options.port });
        this.emitEvent(TcpEventType.ServerListening, {
          address: `${this.options.host}:${this.options.port}`,
        });
        resolve();
      });

      // 超时处理
      this.server.on('connection', (socket) => {
        socket.setTimeout(this.options.heartbeatTimeout + 5000);
        socket.on('timeout', () => {
          socket.destroy(new Error('Socket timeout'));
        });
      });
    });
  }

  /**
   * 停止服务端
   */
  async stop(): Promise<void> {
    // 关闭所有连接
    for (const [id, conn] of this.connections) {
      conn.close();
      this.emitEvent(TcpEventType.ClientDisconnected, {
        clientId: id,
        instanceId: conn.instanceId ?? undefined,
      });
    }
    this.connections.clear();

    return new Promise((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }

      this.server.close(() => {
        this.server = null;
        this.listening = false;
        resolve();
      });

      // 强制关闭
      this.server.unref();
    });
  }

  /**
   * 向指定客户端发送消息
   */
  sendTo(clientId: string, message: string): boolean {
    const conn = this.connections.get(clientId);
    if (!conn || !conn.isConnected) return false;
    conn.send(message);
    return true;
  }

  /**
   * 设置消息处理器工厂
   * 每个新连接建立时，会调用此工厂创建对应的 MessageHandler
   */
  setMessageHandlerFactory(factory: (connectionId: string) => MessageHandler): void {
    this.messageHandlerFactory = factory;
  }

  /** 向所有已连接的客户端广播消息 */
  broadcast(message: string): void {
    for (const conn of this.connections.values()) {
      if (conn.isConnected) {
        conn.send(message);
      }
    }
  }

  // ── 内部方法 ──

  private handleNewConnection(socket: Socket): void {
    // 检查连接数上限
    if (this.connections.size >= this.options.maxConnections) {
      socket.end(JSON.stringify({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32009, message: 'Too many connections' },
      }) + '\n');
      socket.destroy();
      return;
    }

    const connection = new TcpConnection(socket, this.validTokens, {
      interval: this.options.heartbeatInterval,
      timeout: this.options.heartbeatTimeout,
      maxFailures: 5,
    });

    // 设置消息处理器（如果已配置工厂）
    if (this.messageHandlerFactory) {
      connection.setHandler(this.messageHandlerFactory(connection.id));
    }

    this.connections.set(connection.id, connection);
    this.emitEvent(TcpEventType.ClientConnected, {
      clientId: connection.id,
      address: connection.address,
    });

    // 监听连接事件
    connection.on(ConnectionEvent.StateChange, (clientId: string, newState: string, prevState: string) => {
      this.emit(ServerEvent.ConnectionStateChange, { clientId, newState, prevState });

      if (newState === 'connected') {
        this.emitEvent(TcpEventType.ClientHandshook, {
          clientId,
          instanceId: connection.instanceId ?? undefined,
        });
      }
    });

    connection.on(ConnectionEvent.Request, (clientId: string, request: JsonRpcRequest) => {
      this.emit(ServerEvent.RequestReceived, { clientId, request });
    });

    connection.on(ConnectionEvent.Notification, (clientId: string, notification: JsonRpcNotification) => {
      this.emit(ServerEvent.NotificationReceived, { clientId, notification });
    });

    // 世界上下文事件转发
    connection.on(ConnectionEvent.WorldOnline, (data: { instanceId: string | null; worldName: string; botCount: number }) => {
      this.emit(ServerEvent.WorldOnline, {
        clientId: connection.id,
        instanceId: data.instanceId,
        worldName: data.worldName,
        botCount: data.botCount,
      });
    });

    connection.on(ConnectionEvent.WorldOffline, (data: { instanceId: string | null; worldName: string; uptimeSeconds: number; botCount: number; reason?: string }) => {
      this.emit(ServerEvent.WorldOffline, {
        clientId: connection.id,
        instanceId: data.instanceId,
        worldName: data.worldName,
        uptimeSeconds: data.uptimeSeconds,
        botCount: data.botCount,
        reason: data.reason,
      });
    });

    connection.on(ConnectionEvent.Closed, () => {
      this.connections.delete(connection.id);
      this.emit(ServerEvent.ConnectionClosed, { clientId: connection.id });
      this.emitEvent(TcpEventType.ClientDisconnected, {
        clientId: connection.id,
        instanceId: connection.instanceId ?? undefined,
      });
    });

    connection.on(ConnectionEvent.Error, (err: Error) => {
      this.emit(ServerEvent.ConnectionError, { clientId: connection.id, error: err.message });
      this.emitEvent(TcpEventType.ClientError, {
        clientId: connection.id,
        error: err.message,
      });
    });

    this.emit(ServerEvent.ConnectionOpened, { clientId: connection.id });
  }

  private emitEvent(type: TcpEventType, extra: Partial<TcpEventData> = {}): void {
    const event: TcpEventData = {
      type,
      timestamp: Date.now(),
      ...extra,
    };
    this.emit('tcp:event', event);
  }
}
