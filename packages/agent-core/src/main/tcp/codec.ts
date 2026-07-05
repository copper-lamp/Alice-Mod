/**
 * JSON-RPC 2.0 消息编解码模块
 *
 * 负责 Request / Response / Notification 的消息解析和组装。
 */

import crypto from 'node:crypto';

import type {
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcSuccessResponse,
  JsonRpcErrorResponse,
  JsonRpcNotification,
  JsonRpcId,
} from '@mcagent/shared';
import { isValidRequest, isValidResponse } from '@mcagent/shared';
import { encodeFrame } from './frame';

// ─── Request ──────────────────────────────────────────────

/** 创建 JSON-RPC 请求 */
export function createRequest(method: string, params?: unknown, id?: JsonRpcId): JsonRpcRequest {
  return {
    jsonrpc: '2.0',
    id: id ?? crypto.randomUUID(),
    method,
    ...(params !== undefined ? { params } : {}),
  };
}

/** 将请求编码为帧 */
export function encodeRequest(method: string, params?: unknown, id?: JsonRpcId): Buffer {
  return encodeFrame(JSON.stringify(createRequest(method, params, id)));
}

/** 解析 JSON 字符串为请求 */
export function parseRequest(json: string): JsonRpcRequest {
  const parsed = JSON.parse(json);
  if (!isValidRequest(parsed)) {
    throw new Error('Invalid JSON-RPC request');
  }
  return parsed;
}

// ─── Response ─────────────────────────────────────────────

/** 创建成功响应 */
export function createSuccessResponse<T = unknown>(id: JsonRpcId, result: T): JsonRpcSuccessResponse {
  return {
    jsonrpc: '2.0',
    id,
    result,
  };
}

/** 创建错误响应 */
export function createErrorResponse(
  id: JsonRpcId,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcErrorResponse {
  return {
    jsonrpc: '2.0',
    id,
    error: { code, message, ...(data !== undefined ? { data } : {}) },
  };
}

/** 将响应编码为帧 */
export function encodeResponse(response: JsonRpcResponse): Buffer {
  return encodeFrame(JSON.stringify(response));
}

/** 解析 JSON 字符串为响应 */
export function parseResponse(json: string): JsonRpcResponse {
  const parsed = JSON.parse(json);
  if (!isValidResponse(parsed)) {
    throw new Error('Invalid JSON-RPC response');
  }
  return parsed;
}

// ─── Notification ─────────────────────────────────────────

/** 创建通知（无 ID，不需要响应） */
export function createNotification(method: string, params?: unknown): JsonRpcNotification {
  return {
    jsonrpc: '2.0',
    method,
    ...(params !== undefined ? { params } : {}),
  };
}

/** 将通知编码为帧 */
export function encodeNotification(method: string, params?: unknown): Buffer {
  return encodeFrame(JSON.stringify(createNotification(method, params)));
}

// ─── 通用 ──────────────────────────────────────────────────

/**
 * 解析 JSON 字符串为任意消息类型（请求/响应/通知）
 * 不校验证，只解析 JSON
 */
export function parseMessage<T = JsonRpcRequest | JsonRpcResponse | JsonRpcNotification>(json: string): T {
  return JSON.parse(json) as T;
}

/** 判断是否为通知（无 id 字段） */
export function isNotification(msg: unknown): msg is JsonRpcNotification {
  if (typeof msg !== 'object' || msg === null) return false;
  const obj = msg as Record<string, unknown>;
  return obj.jsonrpc === '2.0' && typeof obj.method === 'string' && (obj.id === undefined || obj.id === null);
}

/** 判断是否为请求（有 id 字段） */
export function isRequest(msg: unknown): msg is JsonRpcRequest {
  if (typeof msg !== 'object' || msg === null) return false;
  const obj = msg as Record<string, unknown>;
  return obj.jsonrpc === '2.0' && typeof obj.method === 'string' && obj.id !== undefined && obj.id !== null;
}

/** 判断是否为响应（有 result 或 error 字段） */
export function isResponse(msg: unknown): msg is JsonRpcResponse {
  if (typeof msg !== 'object' || msg === null) return false;
  const obj = msg as Record<string, unknown>;
  return obj.jsonrpc === '2.0' && ('result' in obj || 'error' in obj);
}
