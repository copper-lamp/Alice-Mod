/**
 * MessageBridge 测试
 *
 * 覆盖：桥接配置、QQ→游戏桥接、游戏→QQ桥接、过滤规则、方向控制
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MessageBridge } from '../../src/main/qq-bot/message-bridge';
import type { QQMessage, BridgeConfig } from '../../src/main/qq-bot/types';

describe('MessageBridge', () => {
  let bridge: MessageBridge;
  let onBridge: ReturnType<typeof vi.fn>;

  const mockQQMsg = (overrides: Partial<QQMessage> = {}): QQMessage => ({
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
    bridge = new MessageBridge();
    onBridge = vi.fn();
    bridge.onBridge(onBridge);
  });

  // ── 桥接配置 ──

  it('应能配置桥接规则', () => {
    const configs: BridgeConfig[] = [
      { groupId: 'group_001', direction: 'both', prefix: '[QQ]' },
      { groupId: 'group_002', direction: 'qq_to_game' },
    ];

    bridge.configure(configs);
    expect(bridge.getBridges()).toHaveLength(2);
  });

  it('应能添加/移除桥接规则', () => {
    bridge.addBridge({ groupId: 'group_001', direction: 'both' });
    expect(bridge.getBridges()).toHaveLength(1);

    bridge.removeBridge('group_001');
    expect(bridge.getBridges()).toHaveLength(0);
  });

  // ── QQ → 游戏桥接 ──

  it('应桥接 QQ 消息到游戏', () => {
    bridge.addBridge({ groupId: 'group_001', direction: 'both', prefix: '[QQ]' });
    bridge.handleQQMessage(mockQQMsg());

    expect(onBridge).toHaveBeenCalledTimes(1);
    const msg = onBridge.mock.calls[0][0];
    expect(msg.source).toBe('qq');
    expect(msg.content).toBe('你好');
    expect(msg.sender).toBe('用户1');
  });

  it('不应桥接未配置群组的消息', () => {
    bridge.addBridge({ groupId: 'group_002', direction: 'both' });
    bridge.handleQQMessage(mockQQMsg({ groupId: 'group_001' }));

    expect(onBridge).not.toHaveBeenCalled();
  });

  it('应遵循方向控制', () => {
    bridge.addBridge({ groupId: 'group_001', direction: 'game_to_qq' });
    bridge.handleQQMessage(mockQQMsg());

    expect(onBridge).not.toHaveBeenCalled();
  });

  it('私聊消息不应触发桥接', () => {
    bridge.addBridge({ groupId: 'group_001', direction: 'both' });
    bridge.handleQQMessage(mockQQMsg({ type: 'private', groupId: undefined }));

    expect(onBridge).not.toHaveBeenCalled();
  });

  // ── 游戏 → QQ 桥接 ──

  it('应桥接游戏消息到 QQ', () => {
    bridge.addBridge({ groupId: 'group_001', direction: 'both', prefix: '[游戏]' });
    bridge.addBridge({ groupId: 'group_002', direction: 'both' });

    const results = bridge.handleGameMessage('我找到钻石了', 'Steve');

    expect(results).toHaveLength(2);
    expect(results[0].source).toBe('game');
    expect(results[0].content).toBe('我找到钻石了');
    expect(results[0].sender).toBe('Steve');
    expect(results[0].groupId).toBe('group_001');
  });

  it('游戏→QQ 桥接应遵循方向控制', () => {
    bridge.addBridge({ groupId: 'group_001', direction: 'qq_to_game' });
    const results = bridge.handleGameMessage('测试', 'Steve');

    expect(results).toHaveLength(0);
  });

  // ── 过滤规则 ──

  it('关键词过滤应仅放行匹配消息', () => {
    bridge.addBridge({
      groupId: 'group_001',
      direction: 'both',
      filter: { keywords: ['钻石', '铁'] },
    });

    // 不匹配
    bridge.handleQQMessage(mockQQMsg({ content: '你好' }));
    expect(onBridge).not.toHaveBeenCalled();

    // 匹配
    bridge.handleQQMessage(mockQQMsg({ content: '我找到钻石了' }));
    expect(onBridge).toHaveBeenCalledTimes(1);
  });

  it('用户白名单过滤', () => {
    bridge.addBridge({
      groupId: 'group_001',
      direction: 'both',
      filter: { users: ['user_001'] },
    });

    bridge.handleQQMessage(mockQQMsg({ userId: 'user_002' }));
    expect(onBridge).not.toHaveBeenCalled();

    bridge.handleQQMessage(mockQQMsg({ userId: 'user_001' }));
    expect(onBridge).toHaveBeenCalledTimes(1);
  });
});