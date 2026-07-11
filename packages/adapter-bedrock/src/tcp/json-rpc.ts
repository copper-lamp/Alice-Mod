/**
 * JSON-RPC 2.0 消息编解码
 *
 * 提供请求/响应/通知的构造、解析、类型判断功能。
 * 所有消息以 \n 作为帧分隔符。
 */

// ── 类型定义 ──

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: Record<string, any>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, any>;
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcResponse | JsonRpcNotification;

// ── 错误码 ──

export const JSONRPC_ERROR_CODES = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  TOOL_TIMEOUT: -32005,
} as const;

// ── 编解码 ──

export class JsonRpcCodec {
  /**
   * 构造请求消息（含 id）
   */
  static encodeRequest(method: string, params: any, id: number): string {
    return JSON.stringify({
      jsonrpc: '2.0',
      id,
      method,
      params,
    }) + '\n';
  }

  /**
   * 构造通知消息（无 id）
   */
  static encodeNotification(method: string, params: any): string {
    return JSON.stringify({
      jsonrpc: '2.0',
      method,
      params,
    }) + '\n';
  }

  /**
   * 构造成功响应
   */
  static encodeResponse(id: number | string, result: any): string {
    return JSON.stringify({
      jsonrpc: '2.0',
      id,
      result,
    }) + '\n';
  }

  /**
   * 构造错误响应
   */
  static encodeError(
    id: number | string,
    code: number,
    message: string,
    data?: any,
  ): string {
    return JSON.stringify({
      jsonrpc: '2.0',
      id,
      error: { code, message, data },
    }) + '\n';
  }

  /**
   * 解析 JSON-RPC 消息
   */
  static parse(raw: string): JsonRpcMessage {
    return JSON.parse(raw);
  }

  /**
   * 判断是否为请求（含 method 和 id）
   */
  static isRequest(msg: JsonRpcMessage): msg is JsonRpcRequest {
    return 'method' in msg && 'id' in msg;
  }

  /**
   * 判断是否为通知（含 method 但不含 id）
   */
  static isNotification(msg: JsonRpcMessage): msg is JsonRpcNotification {
    return 'method' in msg && !('id' in msg);
  }

  /**
   * 判断是否为响应（含 id 但不含 method）
   */
  static isResponse(msg: JsonRpcMessage): msg is JsonRpcResponse {
    return 'id' in msg && !('method' in msg);
  }
}