/**
 * QQ 群管理工具与主动通知工具测试
 *
 * 覆盖场景：
 * - qq_group_manage: kick / mute / set_card / approve_join / recall
 * - 参数校验与错误处理
 * - qq_notify: 模板渲染、空内容校验
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { qqGroupManage, QQ_GROUP_MANAGE_TOOL_SCHEMA } from '../../src/main/qq-bot/tools/qq_group_manage';
import { qqNotify, QQ_NOTIFY_TOOL_SCHEMA } from '../../src/main/qq-bot/tools/qq_notify';

describe('qq_group_manage 工具', () => {
  const mockClient = {
    setGroupKick: vi.fn(),
    setGroupBan: vi.fn(),
    setGroupCard: vi.fn(),
    setGroupAddRequest: vi.fn(),
    deleteMsg: vi.fn(),
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient.setGroupKick.mockResolvedValue({ success: true });
    mockClient.setGroupBan.mockResolvedValue({ success: true });
    mockClient.setGroupCard.mockResolvedValue({ success: true });
    mockClient.setGroupAddRequest.mockResolvedValue({ success: true });
    mockClient.deleteMsg.mockResolvedValue({ success: true });
  });

  it('应踢出成员', async () => {
    const result = await qqGroupManage(mockClient, { action: 'kick', group_id: '123', user_id: '456' });
    expect(result.success).toBe(true);
    expect(mockClient.setGroupKick).toHaveBeenCalledWith('123', '456');
  });

  it('踢人缺少 user_id 应返回错误', async () => {
    const result = await qqGroupManage(mockClient, { action: 'kick', group_id: '123' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('踢人操作需要 user_id');
  });

  it('应禁言成员', async () => {
    const result = await qqGroupManage(mockClient, { action: 'mute', group_id: '123', user_id: '456', duration: 3600 });
    expect(result.success).toBe(true);
    expect(mockClient.setGroupBan).toHaveBeenCalledWith('123', '456', 3600);
  });

  it('禁言缺少 duration 应返回错误', async () => {
    const result = await qqGroupManage(mockClient, { action: 'mute', group_id: '123', user_id: '456' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('禁言操作需要 duration（秒）');
  });

  it('禁言 duration 为负数应返回错误', async () => {
    const result = await qqGroupManage(mockClient, { action: 'mute', group_id: '123', user_id: '456', duration: -1 });
    expect(result.success).toBe(false);
    expect(result.error).toBe('禁言操作需要 duration（秒）');
  });

  it('应设置群名片', async () => {
    const result = await qqGroupManage(mockClient, { action: 'set_card', group_id: '123', user_id: '456', card: '名片' });
    expect(result.success).toBe(true);
    expect(mockClient.setGroupCard).toHaveBeenCalledWith('123', '456', '名片');
  });

  it('设置群名片缺少 card 应返回错误', async () => {
    const result = await qqGroupManage(mockClient, { action: 'set_card', group_id: '123', user_id: '456' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('设置群名片需要 card');
  });

  it('应审批入群申请', async () => {
    const result = await qqGroupManage(mockClient, { action: 'approve_join', group_id: '123', flag: 'req_001' });
    expect(result.success).toBe(true);
    expect(mockClient.setGroupAddRequest).toHaveBeenCalledWith('req_001', true, undefined);
  });

  it('应拒绝入群申请并附带原因', async () => {
    const result = await qqGroupManage(mockClient, { action: 'approve_join', group_id: '123', flag: 'req_001', approve: false, reason: '已满员' });
    expect(result.success).toBe(true);
    expect(mockClient.setGroupAddRequest).toHaveBeenCalledWith('req_001', false, '已满员');
  });

  it('审批入群缺少 flag 应返回错误', async () => {
    const result = await qqGroupManage(mockClient, { action: 'approve_join', group_id: '123' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('审批入群需要 flag');
  });

  it('应撤回消息', async () => {
    const result = await qqGroupManage(mockClient, { action: 'recall', group_id: '123', message_id: 'msg_001' });
    expect(result.success).toBe(true);
    expect(mockClient.deleteMsg).toHaveBeenCalledWith('msg_001');
  });

  it('撤回消息缺少 message_id 应返回错误', async () => {
    const result = await qqGroupManage(mockClient, { action: 'recall', group_id: '123' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('撤回消息需要 message_id');
  });

  it('未知动作应返回错误', async () => {
    const result = await qqGroupManage(mockClient, { action: 'unknown' as any, group_id: '123' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('未知的群管理动作');
  });

  it('工具 schema 应包含所需字段', () => {
    expect(QQ_GROUP_MANAGE_TOOL_SCHEMA.name).toBe('qq_group_manage');
    expect(QQ_GROUP_MANAGE_TOOL_SCHEMA.input_schema.required).toContain('action');
    expect(QQ_GROUP_MANAGE_TOOL_SCHEMA.input_schema.required).toContain('group_id');
  });
});

describe('qq_notify 工具', () => {
  const mockClient = {
    sendGroupMsg: vi.fn(),
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient.sendGroupMsg.mockResolvedValue({ success: true, messageId: 'n1' });
  });

  it('应发送通知消息', async () => {
    const result = await qqNotify(mockClient, { group_id: '123', content: '服务器即将重启' });
    expect(result.success).toBe(true);
    expect(mockClient.sendGroupMsg).toHaveBeenCalledWith('123', '服务器即将重启');
  });

  it('应渲染模板变量', async () => {
    const result = await qqNotify(
      mockClient,
      { group_id: '123', content: '玩家 {{player}} 死亡，坐标 {{pos}}' },
      { player: 'Alice', pos: '100,64,200' },
    );
    expect(result.success).toBe(true);
    expect(mockClient.sendGroupMsg).toHaveBeenCalledWith('123', '玩家 Alice 死亡，坐标 100,64,200');
  });

  it('空内容应返回错误', async () => {
    const result = await qqNotify(mockClient, { group_id: '123', content: '   ' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('通知内容不能为空');
  });

  it('模板变量缺失应渲染为空', async () => {
    const result = await qqNotify(mockClient, { group_id: '123', content: 'hi {{name}}' }, {});
    expect(result.success).toBe(true);
    expect(mockClient.sendGroupMsg).toHaveBeenCalledWith('123', 'hi ');
  });

  it('工具 schema 应包含所需字段', () => {
    expect(QQ_NOTIFY_TOOL_SCHEMA.name).toBe('qq_notify');
    expect(QQ_NOTIFY_TOOL_SCHEMA.input_schema.required).toEqual(['group_id', 'content']);
  });
});
