/**
 * 握手协议 — 连接认证
 *
 * 客户端连接后发送 hello 消息，携带 instance_id / auth_token / game_version 等，
 * 服务端验证后返回 HelloResult。
 */

// ── 握手消息类型 ──

export interface HelloParams {
  instance_id: string;
  schema_version: string;
  auth_token: string;
  game_version: {
    edition: 'bedrock';
    version: string;
  };
  mod_version: string;
}

export interface HelloResult {
  session_id: string;
  server_version: string;
  heartbeat_interval_ms: number;
  accepted: boolean;
  message?: string;
}

// ── 默认值 ──

export const DEFAULT_SCHEMA_VERSION = '1.0.0';
export const DEFAULT_MOD_VERSION = '1.0.0';

/**
 * 判断握手是否成功
 */
export function isHandshakeAccepted(result: HelloResult): boolean {
  return result.accepted === true;
}

/**
 * 构建握手参数
 */
export function buildHelloParams(options: {
  instanceId: string;
  authToken: string;
  gameVersion: string;
  schemaVersion?: string;
  modVersion?: string;
}): HelloParams {
  return {
    instance_id: options.instanceId,
    schema_version: options.schemaVersion || DEFAULT_SCHEMA_VERSION,
    auth_token: options.authToken,
    game_version: {
      edition: 'bedrock',
      version: options.gameVersion,
    },
    mod_version: options.modVersion || DEFAULT_MOD_VERSION,
  };
}