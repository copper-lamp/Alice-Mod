/**
 * TCP 模块类型定义
 */

import type { JsonRpcId, JsonRpcError, ErrorCode } from '@mcagent/shared';

/** 连接状态 */
export enum ConnectionState {
  Disconnected = 'disconnected',
  Connecting = 'connecting',
  Handshaking = 'handshaking',
  Connected = 'connected',
}

/** 客户端版本信息 */
export interface ClientVersion {
  protocol: string;
  edition: 'bedrock' | 'java';
  mod?: string;
}

/** TCP 客户端信息 */
export interface TcpClientInfo {
  id: string;
  address: string;
  instanceId: string;
  state: ConnectionState;
  version: ClientVersion | null;
  connectedAt: number;
  lastActivity: number;
  toolCount: number;
}

/** 服务端配置 */
export interface TcpServerOptions {
  host: string;
  port: number;
  maxConnections: number;
  heartbeatInterval: number;
  heartbeatTimeout: number;
  /** 允许的 auth_token 集合，为空时会创建默认集合 */
  authTokens?: Set<string>;
}

/** 连接事件 */
export enum TcpEventType {
  ClientConnected = 'client:connected',
  ClientDisconnected = 'client:disconnected',
  ClientHandshook = 'client:handshook',
  ClientTimeout = 'client:timeout',
  ClientError = 'client:error',
  ServerError = 'server:error',
  ServerListening = 'server:listening',
  ServerClosed = 'server:closed',
}

/** 连接事件数据 */
export interface TcpEventData {
  type: TcpEventType;
  clientId?: string;
  instanceId?: string;
  address?: string;
  error?: string;
  timestamp: number;
}

/** 粘包解码结果 */
export interface DecodeResult {
  messages: string[];
  remaining: Buffer;
}

/** 消息回调 */
export type MessageCallback = (clientId: string, message: string) => void;

/** 连接状态变更回调 */
export type StateChangeCallback = (clientId: string, state: ConnectionState, previousState: ConnectionState) => void;

/** 认证配置 */
export const DEFAULT_AUTH_TOKEN = 'mcagent-default-token';

/** 默认 TCP 服务端选项 */
export const DEFAULT_SERVER_OPTIONS: TcpServerOptions = {
  host: '0.0.0.0',
  port: 27541,
  maxConnections: 10,
  heartbeatInterval: 10000,
  heartbeatTimeout: 30000,
};

/** 错误码映射：自定义错误码 → 标准 JSON-RPC 格式 */
export function createErrorResponse(id: JsonRpcId, code: ErrorCode, message: string, data?: unknown) {
  return {
    jsonrpc: '2.0' as const,
    id,
    error: { code, message, data } as JsonRpcError,
  };
}

/** 重连延迟计算（指数退避） */
export function calculateReconnectDelay(attempt: number, baseDelay: number): number {
  const delay = baseDelay * Math.pow(2, attempt - 1);
  return Math.min(delay, 16000); // 上限 16s
}
