/**
 * TCP 模块 - 与 Minecraft Adapter Core 通信
 *
 * 子模块：
 * - types: 类型定义
 * - frame: 粘包处理
 * - codec: JSON-RPC 消息编解码
 * - handshake: 握手认证协议
 * - heartbeat: 心跳管理
 * - batch: Batch 调用支持
 * - connection: 单个连接管理
 * - tcp-server: TCP 服务端
 */

export { TcpServer, ServerEvent } from './tcp-server';
export { TcpConnection, ConnectionEvent, type MessageHandler } from './connection';
export { HeartbeatManager, HeartbeatState, HeartbeatEvent, DEFAULT_HEARTBEAT_OPTIONS } from './heartbeat';
export { HandshakeHandler, type HandshakeParams, type HandshakeResult } from './handshake';
export { FrameAccumulator, encodeFrame, decodeFrames, encodeFrames, FRAME_DELIMITER } from './frame';
export { isBatch, parseBatch, BatchCollector } from './batch';
export {
  createRequest,
  createSuccessResponse,
  createErrorResponse,
  createNotification,
  encodeRequest,
  encodeNotification,
  encodeResponse,
  parseRequest,
  parseResponse,
  parseMessage,
  isRequest,
  isResponse,
  isNotification,
} from './codec';
export {
  ConnectionState,
  TcpEventType,
  type TcpServerOptions,
  type TcpClientInfo,
  type TcpEventData,
  type ClientVersion,
  type DecodeResult,
  DEFAULT_SERVER_OPTIONS,
  DEFAULT_AUTH_TOKEN,
  calculateReconnectDelay,
} from './types';
