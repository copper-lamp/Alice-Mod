/**
 * Batch 调用支持模块
 *
 * 支持批量消息接收与分发：
 * - 识别 Batch 请求（JSON 数组）
 * - 逐个解析每个子请求
 * - 收集结果后批量返回
 */

import type { JsonRpcRequest, JsonRpcResponse } from '@mcagent/shared';

/** Batch 处理结果 */
export interface BatchResult {
  requests: JsonRpcRequest[];
  responses: JsonRpcResponse[];
}

/**
 * 判断是否为 Batch 请求
 * Batch 请求是一个 JSON 数组，包含多个 Request 对象
 */
export function isBatch(data: unknown): data is unknown[] {
  return Array.isArray(data) && data.length > 0;
}

/**
 * 解析 Batch 消息
 *
 * @param data - 已解析的 JSON 数据（应为数组）
 * @returns 解析出的请求列表
 */
export function parseBatch(data: unknown[]): JsonRpcRequest[] {
  const requests: JsonRpcRequest[] = [];

  for (let i = 0; i < data.length; i++) {
    const item = data[i];
    if (typeof item !== 'object' || item === null) continue;

    const obj = item as Record<string, unknown>;
    if (obj.jsonrpc !== '2.0' || typeof obj.method !== 'string') continue;

    requests.push({
      jsonrpc: '2.0',
      id: (obj.id as JsonRpcRequest['id']) ?? null,
      method: obj.method as string,
      params: obj.params,
    });
  }

  return requests;
}

/**
 * 批量处理结果收集器
 *
 * 用于收集多个请求的响应结果，统一返回
 */
export class BatchCollector {
  private readonly responses: Map<string | number, JsonRpcResponse> = new Map();
  private readonly totalCount: number;
  private resolvedCount = 0;

  constructor(requests: JsonRpcRequest[]) {
    this.totalCount = requests.length;
  }

  /**
   * 添加单个响应
   */
  addResponse(response: JsonRpcResponse): void {
    if (response.id !== null && response.id !== undefined) {
      this.responses.set(response.id.toString(), response);
    }
    this.resolvedCount++;
  }

  /**
   * 是否所有请求都已收集到响应
   */
  get isComplete(): boolean {
    return this.resolvedCount >= this.totalCount;
  }

  /**
   * 获取所有收集到的响应
   */
  getResponses(): JsonRpcResponse[] {
    return Array.from(this.responses.values());
  }

  /**
   * 获取已收集数量
   */
  get collectedCount(): number {
    return this.resolvedCount;
  }
}
