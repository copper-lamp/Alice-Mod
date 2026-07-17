/**
 * 配置管理测试
 *
 * 覆盖：默认配置、WS URL 构建、配置验证
 */

import { describe, it, expect } from 'vitest';
import { DEFAULT_QQ_BOT_CONFIG, buildWsUrl, buildOneBotConfig, validateConfig } from '../../src/main/qq-bot/config';
import { QQPermission } from '../../src/main/qq-bot/types';

describe('QQ Bot 配置管理', () => {
  // ── 默认配置 ──

  it('默认配置应包含完整结构', () => {
    expect(DEFAULT_QQ_BOT_CONFIG.enabled).toBe(true);
    expect(DEFAULT_QQ_BOT_CONFIG.mode).toBe('desktop');
    expect(DEFAULT_QQ_BOT_CONFIG.docker).toBeDefined();
    expect(DEFAULT_QQ_BOT_CONFIG.docker!.account).toBe('');
    expect(DEFAULT_QQ_BOT_CONFIG.docker!.autoStart).toBe(false);
    expect(DEFAULT_QQ_BOT_CONFIG.authorization.defaultPermission).toBe(QQPermission.BASIC);
    expect(DEFAULT_QQ_BOT_CONFIG.subAgent.maxHistoryRounds).toBe(10);
  });

  // ── WS URL 构建 ──

  it('Docker 模式应构建正确 WS URL（默认端口 3001）', () => {
    const url = buildWsUrl(DEFAULT_QQ_BOT_CONFIG);
    expect(url).toBe('ws://127.0.0.1:3001');
  });

  it('外部模式应使用自定义主机和端口', () => {
    const config = {
      ...DEFAULT_QQ_BOT_CONFIG,
      mode: 'external' as const,
      external: { wsHost: '192.168.1.100', wsPort: 8080, wsProtocol: 'ws' as const, accessToken: '' },
    };
    expect(buildWsUrl(config)).toBe('ws://192.168.1.100:8080');
  });

  it('外部模式应支持 wss 协议', () => {
    const config = {
      ...DEFAULT_QQ_BOT_CONFIG,
      mode: 'external' as const,
      external: { wsHost: 'example.com', wsPort: 443, wsProtocol: 'wss' as const, accessToken: '' },
    };
    expect(buildWsUrl(config)).toBe('wss://example.com:443');
  });

  it('托管模式（已废弃）应返回本地地址', () => {
    const config = {
      ...DEFAULT_QQ_BOT_CONFIG,
      mode: 'managed' as const,
      managed: { account: '123456', autoStart: true, autoUpdate: false },
    };
    expect(buildWsUrl(config)).toBe('ws://127.0.0.1:3001');
  });

  it('Docker 模式应使用自定义端口', () => {
    const config = {
      ...DEFAULT_QQ_BOT_CONFIG,
      mode: 'docker' as const,
      docker: { account: '123456', autoStart: true, autoUpdate: false, oneBotPort: 3002 },
    };
    expect(buildWsUrl(config)).toBe('ws://127.0.0.1:3002');
  });

  // ── OneBot 客户端配置 ──

  it('外部模式 buildOneBotConfig 应返回 WS URL 和 Token', () => {
    const config = {
      ...DEFAULT_QQ_BOT_CONFIG,
      mode: 'external' as const,
      external: { wsHost: '10.0.0.1', wsPort: 3001, wsProtocol: 'ws' as const, accessToken: 'mytoken' },
    };

    const result = buildOneBotConfig(config);
    expect(result.wsUrl).toBe('ws://10.0.0.1:3001');
    expect(result.accessToken).toBe('mytoken');
  });

  it('Docker 模式 buildOneBotConfig 应使用 docker 配置中的 Token', () => {
    const config = {
      ...DEFAULT_QQ_BOT_CONFIG,
      mode: 'docker' as const,
      docker: { account: '123456', autoStart: true, autoUpdate: false, accessToken: 'dockertoken' },
    };

    const result = buildOneBotConfig(config);
    expect(result.wsUrl).toBe('ws://127.0.0.1:3001');
    expect(result.accessToken).toBe('dockertoken');
  });

  it('无 Token 时应返回 undefined', () => {
    const result = buildOneBotConfig(DEFAULT_QQ_BOT_CONFIG);
    expect(result.accessToken).toBeUndefined();
  });

  // ── 配置验证 ──

  it('有效 Docker 配置应无错误', () => {
    const config = {
      ...DEFAULT_QQ_BOT_CONFIG,
      docker: { account: '123456', autoStart: true, autoUpdate: false },
    };
    const errors = validateConfig(config);
    expect(errors).toHaveLength(0);
  });

  it('Docker 模式应校验 QQ 号', () => {
    const config = {
      ...DEFAULT_QQ_BOT_CONFIG,
      mode: 'docker' as const,
    };
    const errors = validateConfig(config);
    expect(errors).toContain('Docker 模式下 QQ 号不能为空');
  });

  it('外部模式应校验 wsHost', () => {
    const config = {
      ...DEFAULT_QQ_BOT_CONFIG,
      mode: 'external' as const,
      external: { wsHost: '', wsPort: 3001, wsProtocol: 'ws' as const, accessToken: '' },
    };
    const errors = validateConfig(config);
    expect(errors).toContain('外部模式下 wsHost 不能为空');
  });

  it('外部模式应校验 wsPort 范围', () => {
    const config = {
      ...DEFAULT_QQ_BOT_CONFIG,
      mode: 'external' as const,
      external: { wsHost: '127.0.0.1', wsPort: 99999, wsProtocol: 'ws' as const, accessToken: '' },
    };
    const errors = validateConfig(config);
    expect(errors).toContain('外部模式下 wsPort 必须在 1-65535 之间');
  });

  it('托管模式（已废弃）应提示使用 docker 模式', () => {
    const config = {
      ...DEFAULT_QQ_BOT_CONFIG,
      mode: 'managed' as const,
      managed: { account: '', autoStart: true, autoUpdate: false },
    };
    const errors = validateConfig(config);
    expect(errors).toContain('managed 模式已废弃，请使用 docker 或 desktop 模式');
  });

  it('应校验冷却时间', () => {
    const config = {
      ...DEFAULT_QQ_BOT_CONFIG,
      docker: { account: '123456', autoStart: true, autoUpdate: false },
      authorization: { ...DEFAULT_QQ_BOT_CONFIG.authorization, cooldownSeconds: 0 },
    };
    const errors = validateConfig(config);
    expect(errors).toContain('冷却时间不能小于 1 秒');
  });

  it('应校验对话历史轮数', () => {
    const config = {
      ...DEFAULT_QQ_BOT_CONFIG,
      docker: { account: '123456', autoStart: true, autoUpdate: false },
      subAgent: { ...DEFAULT_QQ_BOT_CONFIG.subAgent, maxHistoryRounds: 0 },
    };
    const errors = validateConfig(config);
    expect(errors).toContain('对话历史保留轮数不能小于 1');
  });
});