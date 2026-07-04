/**
 * 协议校验工具
 */

import type {
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcError,
  JsonRpcBatchRequest,
} from '../types/index.js';

/** 校验 JSON-RPC 2.0 请求 */
export function isValidRequest(msg: unknown): msg is JsonRpcRequest {
  if (typeof msg !== 'object' || msg === null) return false;
  const obj = msg as Record<string, unknown>;
  return (
    obj.jsonrpc === '2.0' &&
    typeof obj.method === 'string' &&
    (obj.id === undefined || obj.id === null || typeof obj.id === 'string' || typeof obj.id === 'number')
  );
}

/** 校验 JSON-RPC 2.0 响应 */
export function isValidResponse(msg: unknown): msg is JsonRpcResponse {
  if (typeof msg !== 'object' || msg === null) return false;
  const obj = msg as Record<string, unknown>;
  if (obj.jsonrpc !== '2.0') return false;
  if (obj.id === undefined || obj.id === null) return false;
  return 'result' in obj || ('error' in obj && isValidError(obj.error));
}

/** 校验错误对象 */
export function isValidError(err: unknown): err is JsonRpcError {
  if (typeof err !== 'object' || err === null) return false;
  const obj = err as Record<string, unknown>;
  return typeof obj.code === 'number' && typeof obj.message === 'string';
}

/** 校验批量请求 */
export function isValidBatchRequest(msgs: unknown): msgs is JsonRpcBatchRequest {
  return Array.isArray(msgs) && msgs.length > 0 && msgs.every(isValidRequest);
}

/** 创建 JSON-RPC 2.0 请求 */
export function createRequest(method: string, params?: unknown, id?: string | number): JsonRpcRequest {
  return {
    jsonrpc: '2.0',
    id: id ?? crypto.randomUUID(),
    method,
    params,
  };
}

/** 创建 JSON-RPC 2.0 成功响应 */
export function createSuccessResponse<T>(id: string | number, result: T): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id,
    result,
  };
}

/** 创建 JSON-RPC 2.0 错误响应 */
export function createErrorResponse(id: string | number, code: number, message: string, data?: unknown): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id,
    error: { code, message, data },
  };
}
