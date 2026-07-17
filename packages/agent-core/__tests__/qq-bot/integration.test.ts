/**
 * QQ 机器人模块集成测试
 *
 * 覆盖：完整消息处理流程、权限 → 路由 → Sub-Agent → 回复
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MessageHandler } from '../../src/main/qq-bot/message-handler';
import { PermissionManager } from '../../src/main/qq-bot/permission';
import { MessageBridge } from '../../src/main/qq-bot/message-bridge';
import { QQSubAgent } from '../../src/main/qq-bot/qq-sub-agent';
import { DEFAULT_QQ_BOT_CONFIG, buildWsUrl, validateConfig } from '../../src/main/qq-bot/config';
import { QQPermission } from '../../src/main/qq-bot/types';
import type { QQMessage } from '../../src/main/qq-bot/types';

describe('QQ 机器人集成测试', () => {
  let permissionManager: PermissionManager;
  let messageBridge: MessageBridge;
  let subAgent: QQSubAgent;
  let messageHandler: MessageHandler;
  let mockProvider: { chat: ReturnType<typeof vi.fn> };
  let mockResolve: ReturnType<typeof vi.fn>;
  let mockGetProvider: ReturnType<typeof vi.fn>;

  const mockMsg = (overrides: Partial<QQMessage> = {}): QQMessage => ({
    id: 'msg_001',
    type: 'group',
    groupId: 'group_001',
    userId: 'user_001',
    userName: '用户1',
    content: '测试',
    rawContent: '测试',
    segments: [{ type: 'text', data: { text: '测试' } }],
    timestamp: Date.now(),
    read: false,
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();

    permissionManager = new PermissionManager({
      ownerId: 'owner',
      admins: ['admin'],
      whitelist: [],
      defaultPermission: QQPermission.BASIC,
      cooldownSeconds: 0,
    });

    messageBridge = new MessageBridge();

    mockResolve = vi.fn().mockResolvedValue({
      providerId: 'test-provider',
      model: 'test-model',
      options: {},
    });

    mockProvider = {
      chat: vi.fn().mockResolvedValue({
        message: { role: 'assistant', content: '回复消息' },
        usage: { promptTokens: 50, completionTokens: 10, totalTokens: 60 },
        model: 'test-model',
        requestId: 'req_001',
        durationMs: 100,
        truncated: false,
        finishReason: 'stop',
      }),
    };

    mockGetProvider = vi.fn().mockReturnValue(mockProvider);

    subAgent = new QQSubAgent(
      { resolve: mockResolve } as any,
      mockGetProvider as any,
      { enabled: true },
    );

    messageHandler = new MessageHandler(permissionManager, messageBridge, subAgent);
  });

  afterEach(() => {
    permissionManager.destroy();
  });

  // ── 完整消息处理流程 ──

  it('完整流程：消息 → 路由 → Sub-Agent → 回复', async () => {
    await subAgent.start();

    const subAgentEvents: any[] = [];
    subAgent.onEvent(e => subAgentEvents.push(e));

    // 1. 路由消息
    const route = await messageHandler.route(mockMsg({ content: '我有什么装备？' }));
    expect(route.type).toBe('sub_agent');

    // 2. Sub-Agent 处理
    if (route.type === 'sub_agent') {
      await subAgent.handleMessage(route.msg);
    }

    // 3. 验证回复
    const reply = subAgentEvents.find(e => e.type === 'reply');
    expect(reply).toBeDefined();
    expect(reply.reply.content).toBe('回复消息');
  });

  // ── 快速指令流程 ──

  it('完整流程：指令 → 执行 → 回复', async () => {
    const cmdPm = new PermissionManager({ defaultPermission: QQPermission.COMMAND, cooldownSeconds: 0 });
    const cmdHandler = new MessageHandler(cmdPm, messageBridge, subAgent);
    cmdHandler.registerCommand('ping', async () => 'Pong! 服务器已连接');

    const route = await cmdHandler.route(mockMsg({ content: '/ping' }));
    expect(route.type).toBe('command');

    if (route.type === 'command') {
      const result = await cmdHandler.executeCommand(route.command, route.args, route.msg);
      expect(result).toBe('Pong! 服务器已连接');
    }
    cmdPm.destroy();
  });

  // ── 权限 + 消息桥接 + Sub-Agent 联动 ──

  it('桥接消息应直接转发，不经过 Sub-Agent', async () => {
    messageBridge.addBridge({ groupId: 'group_001', direction: 'both', prefix: '[QQ]' });

    const bridgeEvents: any[] = [];
    messageBridge.onBridge(e => bridgeEvents.push(e));

    // 桥接消息不走 Sub-Agent
    messageBridge.handleQQMessage(mockMsg({ content: '游戏里见' }));
    expect(bridgeEvents).toHaveLength(1);
    expect(bridgeEvents[0].source).toBe('qq');
  });

  // ── 配置验证 ──

  it('默认配置应有效', () => {
    const config = {
      ...DEFAULT_QQ_BOT_CONFIG,
      docker: { account: '123456', autoStart: true, autoUpdate: false },
    };
    const errors = validateConfig(config);
    expect(errors).toHaveLength(0);
  });

  it('buildWsUrl 应返回正确 URL', () => {
    expect(buildWsUrl(DEFAULT_QQ_BOT_CONFIG)).toBe('ws://127.0.0.1:3001');
  });
});