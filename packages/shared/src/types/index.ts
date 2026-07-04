/**
 * JSON-RPC 2.0 核心类型定义
 */

/** JSON-RPC 2.0 请求 ID */
export type JsonRpcId = string | number | null;

/** JSON-RPC 2.0 请求 */
export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: JsonRpcId;
  method: string;
  params?: unknown;
}

/** JSON-RPC 2.0 成功响应 */
export interface JsonRpcSuccessResponse<T = unknown> {
  jsonrpc: '2.0';
  id: JsonRpcId;
  result: T;
}

/** JSON-RPC 2.0 错误响应 */
export interface JsonRpcErrorResponse {
  jsonrpc: '2.0';
  id: JsonRpcId;
  error: JsonRpcError;
}

/** JSON-RPC 2.0 错误对象 */
export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

/** JSON-RPC 2.0 批量请求/响应 */
export type JsonRpcBatchRequest = JsonRpcRequest[];
export type JsonRpcBatchResponse = (JsonRpcSuccessResponse | JsonRpcErrorResponse)[];

/** JSON-RPC 2.0 通知（无 ID，不需要响应） */
export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

/** 联合类型：请求或通知 */
export type JsonRpcMessage = JsonRpcRequest | JsonRpcResponse | JsonRpcNotification;
export type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;

/** 标准 JSON-RPC 错误码 */
export enum ErrorCode {
  ParseError = -32700,
  InvalidRequest = -32600,
  MethodNotFound = -32601,
  InvalidParams = -32602,
  InternalError = -32603,
  /** 自定义：工具执行超时 */
  ToolTimeout = -32000,
  /** 自定义：工具执行失败 */
  ToolExecutionFailed = -32001,
  /** 自定义：认证失败 */
  AuthFailed = -32002,
  /** 自定义：连接断开 */
  ConnectionLost = -32003,
}
