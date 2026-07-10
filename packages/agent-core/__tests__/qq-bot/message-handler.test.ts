/**
 * MessageHandler 测试
 *
 * 覆盖：消息路由分发、权限检查、指令解析、Sub-Agent 路由
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MessageHandler } from '../../src/main/qq-bot/message-handler';
import { PermissionManager } from '../../src/main/qq-bot/permission';
import { MessageBridge } from '../../src/main/qq-bot/message-bridge';
import { QQSubAgent } from '../../src/main/qq-bot/qq-sub-agent';
import { QQPermission } from '../../src/main/qq-bot/types';
import type { QQMessage } from '../../src/main/qq-bot/types';

describe('MessageHandler', () => {
  const mockModelRouter = { resolve: vi.fn() };
  const mockGetProvider = vi.fn();
  const permissionManager = new PermissionManager({
    ownerId: 'owner',
    admins: ['admin'],
    whitelist: [],
    defaultPermission: QQPermission.BASIC,
    cooldownSeconds: 0, // 禁用冷却便于测试
  });
  const messageBridge = new MessageBridge();
  const subAgent = new QQSubAgent(mockModelRouter as any, mockGetProvider as any);
  let handler: MessageHandler;

  const mockMsg = (overrides: Partial<QQMessage> = {}): QQMessage => ({
    id: 'msg_001',
    type: 'group',
    groupId: 'group_001',
    userId: 'user_001',
    userName: '用户1',
    content: '你好',
    rawContent: '你好',
    segments: [{ type: 'text', data: { text: '你好' } }],
    timestamp: Date.now(),
    read: false,
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    handler = new MessageHandler(permissionManager, messageBridge, subAgent);
  });

  afterEach(() => {
    permissionManager.destroy();
  });

  // ── 路由分发 ──

  it('应将普通消息路由到 Sub-Agent', async () => {
    const route = await handler.route(mockMsg());
    expect(route.type).toBe('sub_agent');
  });

  it('应将 / 开头的消息识别为指令', async () => {
    const route = await handler.route(mockMsg({ content: '/help 查看帮助' }));
    expect(route.type).toBe('command');
    if (route.type === 'command') {
      expect(route.command).toBe('help');
      expect(route.args).toBe('查看帮助');
    }
  });

  it('应识别无参数的指令', async () => {
    const route = await handler.route(mockMsg({ content: '/status' }));
    expect(route.type).toBe('command');
    if (route.type === 'command') {
      expect(route.command).toBe('status');
      expect(route.args).toBe('');
    }
  });

  // ── 权限检查 ──

  it('应忽略权限不足的消息', async () => {
    const strictPm = new PermissionManager({ defaultPermission: QQPermission.NONE, cooldownSeconds: 0 });
    const h = new MessageHandler(strictPm, messageBridge, subAgent);
    const route = await h.route(mockMsg());
    expect(route.type).toBe('ignored');
    strictPm.destroy();
  });

  it('私聊禁用时应忽略私聊消息', async () => {
    handler.setAllowPrivate(false);
    const route = await handler.route(mockMsg({ type: 'private', groupId: undefined }));
    expect(route.type).toBe('ignored');
  });

  // ── 指令执行 ──

  it('应能注册并执行快速指令', async () => {
    const cmdPm = new PermissionManager({ defaultPermission: QQPermission.COMMAND, cooldownSeconds: 0 });
    const h = new MessageHandler(cmdPm, messageBridge, subAgent);
    const cmdHandler = vi.fn().mockResolvedValue('执行结果');
    h.registerCommand('test', cmdHandler);

    const result = await h.executeCommand('test', '参数', mockMsg());
    expect(result).toBe('执行结果');
    expect(cmdHandler).toHaveBeenCalledWith('test', '参数', expect.any(Object));
    cmdPm.destroy();
  });

  it('未注册的指令应返回 null', async () => {
    const result = await handler.executeCommand('unknown', '', mockMsg());
    expect(result).toBeNull();
  });

  it('指令应忽略大小写', async () => {
    const cmdPm = new PermissionManager({ defaultPermission: QQPermission.COMMAND, cooldownSeconds: 0 });
    const h = new MessageHandler(cmdPm, messageBridge, subAgent);
    h.registerCommand('Ping', vi.fn().mockResolvedValue('Pong'));
    const result = await h.executeCommand('ping', '', mockMsg());
    expect(result).toBe('Pong');
    cmdPm.destroy();
  });

  it('权限不足时应返回错误消息', async () => {
    // 注册 handler，但用户只有 BASIC 权限（需要 COMMAND）
    handler.registerCommand('test', vi.fn().mockResolvedValue('执行结果'));
    const result = await handler.executeCommand('test', '', mockMsg());
    expect(result).toBe('权限不足，无法执行此指令');
  });

  // ── 频率限制 ──

  it('频率受限的消息应被忽略', async () => {
    const rateLimitedPm = new PermissionManager({
      defaultPermission: QQPermission.BASIC,
      cooldownSeconds: 3600, // 长冷却时间
    });
    const h = new MessageHandler(rateLimitedPm, messageBridge, subAgent);

    // 第一次通过
    await h.route(mockMsg({ content: '你好' }));

    // 第二次频率受限
    const route = await h.route(mockMsg({ content: '再问' }));
    expect(route.type).toBe('ignored');
    expect(route.type === 'ignored' && route.reason).toBe('频率受限');
    rateLimitedPm.destroy();
  });

  // ── 已注册指令路由 ──

  it('已注册指令 /help 应路由到 command', async () => {
    handler.registerCommand('help', vi.fn().mockResolvedValue('帮助信息'));
    const route = await handler.route(mockMsg({ content: '/help 查看帮助' }));
    expect(route.type).toBe('command');
    if (route.type === 'command') {
      expect(route.command).toBe('help');
      expect(route.args).toBe('查看帮助');
    }
  });
});