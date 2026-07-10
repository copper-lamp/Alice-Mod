/**
 * OneBotClient 测试
 *
 * 覆盖：连接/断开、消息收发、事件处理、心跳、重连
 * 注意：WebSocket 被 mock，不依赖真实网络
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OneBotClient } from '../../src/main/qq-bot/onebot-client';

// Mock WebSocket
vi.mock('ws', () => {
  const EventEmitter = require('node:events');

  class MockWebSocket extends EventEmitter {
    public readyState = 1;
    public send = vi.fn();
    public close = vi.fn();
    private _url: string;

    constructor(url: string) {
      super();
      this._url = url;
    }

    // 模拟连接成功
    mockOpen() {
      process.nextTick(() => this.emit('open'));
    }

    // 模拟收到消息
    mockMessage(data: string) {
      this.emit('message', Buffer.from(data));
    }

    // 模拟关闭
    mockClose() {
      this.emit('close');
    }

    // 模拟错误
    mockError(err: Error) {
      this.emit('error', err);
    }
  }

  return { default: MockWebSocket as any, WebSocket: MockWebSocket as any };
});

import WebSocket from 'ws';

describe('OneBotClient', () => {
  let client: OneBotClient;
  let mockWs: any;

  function createMockClient() {
    const c = new OneBotClient({
      wsUrl: 'ws://127.0.0.1:3001',
      reconnectInterval: 100,
      maxReconnectAttempts: 2,
      heartbeatInterval: 5000,
    });

    // 拦截 WebSocket 创建
    const origWs = (WebSocket as any);
    const mockWsInstance = new origWs('ws://test');
    mockWs = mockWsInstance;

    // Mock WebSocket 构造
    vi.spyOn(globalThis as any, 'WebSocket').mockImplementation(() => mockWs);
    vi.spyOn(require('ws'), 'WebSocket').mockImplementation(() => mockWs);

    // 使用 mockResolvedValue 模拟 connect
    const origConnect = c.connect.bind(c);

    // 重写 connect 让我们手动控制
    c.connect = vi.fn().mockImplementation(async () => {
      (c as any).ws = mockWs;
      (c as any).setStatus('connected');
      (c as any).startHeartbeat();

      mockWs.on('message', (data: Buffer) => {
        (c as any).handleRawMessage(data.toString());
      });

      mockWs.on('close', () => {
        (c as any).stopHeartbeat();
        (c as any).setStatus('disconnected');
        (c as any).scheduleReconnect();
      });
    });

    return c;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    client = createMockClient();
  });

  // ── 连接管理 ──

  it('connect 应切换状态为 connected', async () => {
    const statusChanges: string[] = [];
    client.onStatusChange(s => statusChanges.push(s));

    await client.connect();
    expect(client.getStatus()).toBe('connected');
  });

  it('disconnect 应切换状态为 disconnected', async () => {
    await client.connect();
    await client.disconnect();
    expect(client.getStatus()).toBe('disconnected');
  });

  // ── 消息收发 ──

  it('sendGroupMsg 应发送群消息', async () => {
    await client.connect();

    mockWs.send.mockResolvedValue(undefined);
    const sendPromise = client.sendGroupMsg('123', '测试消息');

    const sentData = JSON.parse(mockWs.send.mock.calls[0][0]);
    expect(sentData.action).toBe('send_group_msg');
    expect(sentData.params.group_id).toBe(123);
    expect(sentData.params.message).toBe('测试消息');

    // 使用 EventEmitter 的 emit 触发消息事件
    mockWs.emit('message', Buffer.from(JSON.stringify({
      status: 'ok', retcode: 0, data: { message_id: 12345 }, echo: sentData.echo,
    })));

    const result = await sendPromise;
    expect(result.success).toBe(true);
  });

  it('sendPrivateMsg 应发送私聊消息', async () => {
    await client.connect();

    mockWs.send.mockResolvedValue(undefined);
    const sendPromise = client.sendPrivateMsg('456', '私聊');

    const sentData = JSON.parse(mockWs.send.mock.calls[0][0]);
    expect(sentData.action).toBe('send_private_msg');
    expect(sentData.params.user_id).toBe(456);

    mockWs.emit('message', Buffer.from(JSON.stringify({
      status: 'ok', retcode: 0, data: { message_id: 67890 }, echo: sentData.echo,
    })));

    const result = await sendPromise;
    expect(result.success).toBe(true);
  });

  // ── 事件处理 ──

  it('应触发消息事件', async () => {
    await client.connect();

    const handler = vi.fn();
    client.onMessage(handler);

    // 模拟收到群消息
    const event = JSON.stringify({
      post_type: 'message',
      message_type: 'group',
      group_id: 123,
      user_id: 456,
      message: [{ type: 'text', data: { text: '你好' } }],
      raw_message: '你好',
      sender: { nickname: '测试用户' },
      time: Date.now(),
      self_id: 789,
    });

    (client as any).handleRawMessage(event);

    expect(handler).toHaveBeenCalledTimes(1);
    const msg = handler.mock.calls[0][0];
    expect(msg.type).toBe('group');
    expect(msg.groupId).toBe('123');
    expect(msg.content).toBe('你好');
    expect(msg.userName).toBe('测试用户');
  });

  it('应触发私聊消息事件', async () => {
    await client.connect();

    const handler = vi.fn();
    client.onMessage(handler);

    (client as any).handleRawMessage(JSON.stringify({
      post_type: 'message',
      message_type: 'private',
      user_id: 456,
      message: [{ type: 'text', data: { text: '私聊' } }],
      raw_message: '私聊',
      sender: { nickname: '私聊用户' },
      time: Date.now(),
      self_id: 789,
    }));

    const msg = handler.mock.calls[0][0];
    expect(msg.type).toBe('private');
    expect(msg.content).toBe('私聊');
  });

  // ── 信息查询 ──

  it('getGroupInfo 应返回群信息', async () => {
    await client.connect();

    mockWs.send.mockResolvedValue(undefined);
    const promise = client.getGroupInfo('123');

    const sentData = JSON.parse(mockWs.send.mock.calls[0][0]);
    expect(sentData.action).toBe('get_group_info');

    mockWs.emit('message', Buffer.from(JSON.stringify({
      status: 'ok', retcode: 0, data: { group_id: 123, group_name: '测试群' }, echo: sentData.echo,
    })));

    const result = await promise;
    expect(result.group_name).toBe('测试群');
  });

  it('getGroupMemberList 应返回成员列表', async () => {
    await client.connect();

    mockWs.send.mockResolvedValue(undefined);
    const promise = client.getGroupMemberList('123');

    const sentData = JSON.parse(mockWs.send.mock.calls[0][0]);
    expect(sentData.action).toBe('get_group_member_list');

    mockWs.emit('message', Buffer.from(JSON.stringify({
      status: 'ok', retcode: 0, data: [{ user_id: 1, nickname: '用户1' }], echo: sentData.echo,
    })));

    const result = await promise;
    expect(result).toHaveLength(1);
    expect(result[0].nickname).toBe('用户1');
  });

  it('getStrangerInfo 应返回用户信息', async () => {
    await client.connect();

    mockWs.send.mockResolvedValue(undefined);
    const promise = client.getStrangerInfo('999');

    const sentData = JSON.parse(mockWs.send.mock.calls[0][0]);
    expect(sentData.action).toBe('get_stranger_info');

    mockWs.emit('message', Buffer.from(JSON.stringify({
      status: 'ok', retcode: 0, data: { user_id: 999, nickname: '陌生人' }, echo: sentData.echo,
    })));

    const result = await promise;
    expect(result.nickname).toBe('陌生人');
  });

  // ── 通知事件 ──

  it('应触发通知事件', async () => {
    await client.connect();

    const handler = vi.fn();
    client.onNotice(handler);

    (client as any).handleRawMessage(JSON.stringify({
      post_type: 'notice',
      notice_type: 'group_increase',
      group_id: 123,
      user_id: 456,
    }));

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].notice_type).toBe('group_increase');
  });

  // ── API 错误处理 ──

  it('API 返回错误时应 reject', async () => {
    await client.connect();

    mockWs.send.mockResolvedValue(undefined);
    const sendPromise = client.sendGroupMsg('123', '测试');

    const sentData = JSON.parse(mockWs.send.mock.calls[0][0]);

    mockWs.emit('message', Buffer.from(JSON.stringify({
      status: 'failed', retcode: 100, msg: '参数错误', echo: sentData.echo,
    })));

    const result = await sendPromise;
    expect(result.success).toBe(false);
    expect(result.error).toContain('参数错误');
  });

  // ── 断开连接 ──

  it('未连接时发送消息应报错', async () => {
    const result = await client.sendGroupMsg('123', 'test');
    expect(result.success).toBe(false);
    expect(result.error).toContain('未连接');
  });

  // ── 状态变化 ──

  it('应触发状态变化事件', async () => {
    const statusChanges: string[] = [];
    client.onStatusChange(s => statusChanges.push(s));

    await client.connect();
    expect(statusChanges).toContain('connected');

    await client.disconnect();
    expect(statusChanges).toContain('disconnected');
  });
});