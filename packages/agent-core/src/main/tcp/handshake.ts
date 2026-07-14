/**
 * 握手认证协议模块
 *
 * 流程：
 * 1. Adapter Core 连接后发送 handshake 请求
 * 2. 参数：{ instance_id, auth_token, version: { protocol, edition }, mod? }
 * 3. AC 校验 auth_token → 返回 version 确认或错误
 */

import type { JsonRpcResponse } from '@mcagent/shared';
import { PROTOCOL_VERSION, ErrorCode as SharedErrorCode } from '@mcagent/shared';
import { createSuccessResponse, createErrorResponse } from './codec';

/** 握手请求参数（v2 扩展） */
export interface HandshakeParams {
  instance_id: string;
  auth_token: string;
  version: {
    protocol: string;
    edition: 'bedrock' | 'java';
  };
  mod?: string;

  // ---- v2 新增字段（可选） ----
  /** 当前世界名称，支持世界上下文切换时必填 */
  world_name?: string;
  /** 当前世界是否在线 */
  world_online?: boolean;
  /** 游戏版本，如 "java" */
  edition?: string;
  /** 游戏版本号，如 "1.21.4" */
  game_version?: string;
}

/** 握手成功响应结果 */
export interface HandshakeResult {
  success: true;
  version: string;
  server_name: string;
  max_tools: number;
}

/** 握手处理器 */
export class HandshakeHandler {
  private readonly validTokens: Set<string>;

  constructor(validTokens: string | Set<string>) {
    this.validTokens = typeof validTokens === 'string' ? new Set([validTokens]) : validTokens;
  }

  /**
   * 校验握手参数
   *
   * @param params - 握手请求参数
   * @returns 校验结果（成功返回响应，失败返回错误响应）
   */
  validate(params: unknown): { valid: boolean; response?: JsonRpcResponse; instanceId?: string } {
    // 参数类型校验
    if (typeof params !== 'object' || params === null) {
      return {
        valid: false,
        response: createErrorResponse(null, SharedErrorCode.InvalidParams, 'Handshake params must be an object'),
      };
    }

    const p = params as Record<string, unknown>;

    // 校验 instance_id
    if (typeof p.instance_id !== 'string' || p.instance_id.trim() === '') {
      return {
        valid: false,
        response: createErrorResponse(null, SharedErrorCode.InvalidParams, 'Missing or invalid instance_id'),
      };
    }

    // 校验 auth_token
    if (typeof p.auth_token !== 'string' || p.auth_token.trim() === '') {
      return {
        valid: false,
        response: createErrorResponse(null, SharedErrorCode.AuthFailed, 'Missing or empty auth_token'),
      };
    }

    if (!this.validTokens.has(p.auth_token)) {
      return {
        valid: false,
        response: createErrorResponse(null, SharedErrorCode.AuthFailed, 'Invalid auth_token'),
      };
    }

    // 校验 version 信息
    if (typeof p.version !== 'object' || p.version === null) {
      return {
        valid: false,
        response: createErrorResponse(null, SharedErrorCode.InvalidParams, 'Missing version info'),
      };
    }

    const version = p.version as Record<string, unknown>;
    if (typeof version.protocol !== 'string' || version.protocol.trim() === '') {
      return {
        valid: false,
        response: createErrorResponse(null, SharedErrorCode.VersionMismatch, 'Missing protocol version'),
      };
    }

    if (version.edition !== 'bedrock' && version.edition !== 'java') {
      return {
        valid: false,
        response: createErrorResponse(null, SharedErrorCode.InvalidParams, 'Invalid edition, must be "bedrock" or "java"'),
      };
    }

    // 握手成功
    return {
      valid: true,
      instanceId: p.instance_id,
      response: createSuccessResponse(null, {
        success: true,
        version: PROTOCOL_VERSION,
        server_name: 'Alice Mod Agent Core',
        max_tools: 43,
      } satisfies HandshakeResult),
    };
  }
}
