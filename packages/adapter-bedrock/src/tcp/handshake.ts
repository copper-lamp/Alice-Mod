/**
 * 握手协议 — 连接认证
 *
 * 适配 Agent Core 的实现：
 * - method: "handshake"（非 "hello"）
 * - params: { instance_id, auth_token, version: { protocol, edition } }
 * - result: { success, version, server_name, max_tools }
 */

// ── 握手消息类型 ──

/** AC 期望的握手参数 */
export interface HelloParams {
  instance_id: string;
  auth_token: string;
  version: {
    protocol: string;
    edition: 'bedrock' | 'java';
  };
  mod?: string;
}

/** AC 返回的握手结果 */
export interface HelloResult {
  success: boolean;
  version: string;
  server_name: string;
  max_tools: number;
}

// ── 默认值 ──

export const DEFAULT_SCHEMA_VERSION = '1.0.0';
export const DEFAULT_MOD_VERSION = '1.0.0';

/** 握手方法名（由 AC 定义） */
export const HANDSHAKE_METHOD = 'handshake';

/**
 * 判断握手是否成功
 * AC 返回 result.success === true
 */
export function isHandshakeAccepted(result: HelloResult): boolean {
  return result.success === true;
}

/**
 * 构建握手参数（适配 AC 的实现）
 *
 * AC 期望格式：
 * {
 *   instance_id: string,
 *   auth_token: string,
 *   version: { protocol: string, edition: 'bedrock' | 'java' },
 *   mod?: string
 * }
 */
export function buildHelloParams(options: {
  instanceId: string;
  authToken: string;
  schemaVersion?: string;
  gameEdition?: 'bedrock' | 'java';
  modVersion?: string;
}): HelloParams {
  return {
    instance_id: options.instanceId,
    auth_token: options.authToken,
    version: {
      protocol: options.schemaVersion || DEFAULT_SCHEMA_VERSION,
      edition: options.gameEdition || 'bedrock',
    },
    mod: options.modVersion || DEFAULT_MOD_VERSION,
  };
}

/**
 * 从握手结果中提取心跳间隔
 * AC 未直接返回 heartbeat_interval，默认使用 10000ms
 * 后续可通过 config 配置覆盖
 */
export function extractHeartbeatInterval(_result: HelloResult): number {
  return 10000;
}
