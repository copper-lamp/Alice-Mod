/**
 * QQ 机器人模块配置管理
 */

import type { QQBotConfig, QQSubAgentConfig, BridgeConfig, PermissionConfig } from './types';
import { QQPermission, DEFAULT_SUB_AGENT_CONFIG } from './types';

/** 默认 QQ 机器人配置 */
export const DEFAULT_QQ_BOT_CONFIG: QQBotConfig = {
  enabled: true,
  mode: 'desktop',

  docker: {
    account: '',
    autoStart: false,
    autoUpdate: false,
  },

  external: {
    wsHost: '127.0.0.1',
    wsPort: 3001,
    wsProtocol: 'ws',
    accessToken: '',
  },

  authorization: {
    ownerId: '',
    admins: [],
    whitelist: [],
    defaultPermission: QQPermission.BASIC,
    cooldownSeconds: 3,
  },

  bridges: [],

  subAgent: DEFAULT_SUB_AGENT_CONFIG,

  behavior: {
    replyPrefix: '[McAgent] ',
    maxHistory: 20,
  },
};

/** 构建 OneBot WebSocket URL */
export function buildWsUrl(config: QQBotConfig): string {
  if (config.mode === 'external' && config.external) {
    const { wsHost, wsPort, wsProtocol } = config.external;
    return `${wsProtocol}://${wsHost}:${wsPort}`;
  }
  if (config.mode === 'docker' && config.docker) {
    const port = config.docker.oneBotPort ?? 3001;
    return `ws://127.0.0.1:${port}`;
  }
  if (config.mode === 'desktop') {
    return 'ws://127.0.0.1:3001';
  }
  // 兼容旧的 managed 模式
  return 'ws://127.0.0.1:3001';
}

/** 构建 OneBot 客户端配置 */
export function buildOneBotConfig(config: QQBotConfig): {
  wsUrl: string;
  accessToken?: string;
} {
  const wsUrl = buildWsUrl(config);
  const accessToken = config.mode === 'docker'
    ? config.docker?.accessToken
    : config.mode === 'desktop'
      ? undefined
      : config.external?.accessToken;
  return { wsUrl, accessToken: accessToken || undefined };
}

/** 验证配置 */
export function validateConfig(config: QQBotConfig): string[] {
  const errors: string[] = [];

  if (config.mode === 'external') {
    if (!config.external?.wsHost) {
      errors.push('外部模式下 wsHost 不能为空');
    }
    if (!config.external?.wsPort || config.external.wsPort < 1 || config.external.wsPort > 65535) {
      errors.push('外部模式下 wsPort 必须在 1-65535 之间');
    }
  }

  if (config.mode === 'docker') {
    if (!config.docker?.account) {
      errors.push('Docker 模式下 QQ 号不能为空');
    }
  }

  if (config.mode === 'desktop') {
    // desktop 模式不需要额外验证
  }

  if (config.mode === 'managed') {
    errors.push('managed 模式已废弃，请使用 docker 或 desktop 模式');
  }

  if (config.authorization.cooldownSeconds < 1) {
    errors.push('冷却时间不能小于 1 秒');
  }

  if (config.subAgent.maxHistoryRounds < 1) {
    errors.push('对话历史保留轮数不能小于 1');
  }

  return errors;
}