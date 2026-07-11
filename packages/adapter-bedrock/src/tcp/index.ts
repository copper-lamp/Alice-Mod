/**
 * TCP 客户端模块 — 导出
 */

export { TcpClient, ConnectionState } from './TcpClient.js';
export type { TcpClientConfig } from './TcpClient.js';
export { JsonRpcCodec, JSONRPC_ERROR_CODES } from './json-rpc.js';
export type {
  JsonRpcMessage,
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcNotification,
} from './json-rpc.js';
export { FrameAccumulator } from './message-frame.js';
export {
  buildHelloParams,
  isHandshakeAccepted,
  HANDSHAKE_METHOD,
  extractHeartbeatInterval,
} from './handshake.js';
export type { HelloParams, HelloResult } from './handshake.js';
export { buildPongResponse, isPingNotification } from './heartbeat.js';
export { ReconnectScheduler, RECONNECT_INTERVALS, MAX_RECONNECT_ATTEMPTS } from './reconnect.js';
