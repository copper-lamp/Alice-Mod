/**
 * QQ 工具函数测试 (qq_send / qq_info)
 *
 * 覆盖：qq_send 四种类型、qq_info 三种查询、参数验证、错误处理
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { qqSend } from '../../src/main/qq-bot/qq_send';
import { qqInfo } from '../../src/main/qq-bot/qq_info';

describe('qq_send 工具', () => {
  const mockClient = {
    sendGroupMsg: vi.fn(),
    sendPrivateMsg: vi.fn(),
    sendGroupImage: vi.fn(),
    sendGroupFile: vi.fn(),
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient.sendGroupMsg.mockResolvedValue({ success: true, messageId: 'g123' });
    mockClient.sendPrivateMsg.mockResolvedValue({ success: true, messageId: 'p123' });
    mockClient.sendGroupImage.mockResolvedValue({ success: true, messageId: 'i123' });
    mockClient.sendGroupFile.mockResolvedValue({ success: true, messageId: 'f123' });
  });

  it('应发送群消息', async () => {
    const result = await qqSend(mockClient, { type: 'group_msg', target: 'group_001', content: '你好' });
    expect(result.success).toBe(true);
    expect(mockClient.sendGroupMsg).toHaveBeenCalledWith('group_001', '你好');
  });

  it('群消息缺少内容应返回错误', async () => {
    const result = await qqSend(mockClient, { type: 'group_msg', target: 'group_001' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('群消息内容不能为空');
  });

  it('应发送私聊', async () => {
    const result = await qqSend(mockClient, { type: 'private_msg', target: 'user_001', content: '私聊消息' });
    expect(result.success).toBe(true);
    expect(mockClient.sendPrivateMsg).toHaveBeenCalledWith('user_001', '私聊消息');
  });

  it('私聊缺少内容应返回错误', async () => {
    const result = await qqSend(mockClient, { type: 'private_msg', target: 'user_001' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('私聊消息内容不能为空');
  });

  it('应发送图片', async () => {
    const result = await qqSend(mockClient, { type: 'image', target: 'group_001', file_url: 'https://example.com/img.png' });
    expect(result.success).toBe(true);
    expect(mockClient.sendGroupImage).toHaveBeenCalledWith('group_001', 'https://example.com/img.png');
  });

  it('图片缺少 URL 应返回错误', async () => {
    const result = await qqSend(mockClient, { type: 'image', target: 'group_001' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('图片 URL 不能为空');
  });

  it('应发送文件', async () => {
    const result = await qqSend(mockClient, { type: 'file', target: 'group_001', file_url: 'https://example.com/file.zip', file_name: 'file.zip' });
    expect(result.success).toBe(true);
    expect(mockClient.sendGroupFile).toHaveBeenCalledWith('group_001', 'https://example.com/file.zip', 'file.zip');
  });

  it('文件缺少参数应返回错误', async () => {
    const result = await qqSend(mockClient, { type: 'file', target: 'group_001', file_url: 'url' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('文件和文件名不能为空');
  });

  it('不支持的发送类型应返回错误', async () => {
    const result = await qqSend(mockClient, { type: 'unknown' as any, target: 'g' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('不支持的发送类型');
  });
});

describe('qq_info 工具', () => {
  const mockClient = {
    getGroupInfo: vi.fn(),
    getGroupMemberList: vi.fn(),
    getStrangerInfo: vi.fn(),
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient.getGroupInfo.mockResolvedValue({
      group_id: 123,
      group_name: '测试群',
      member_count: 50,
      max_member_count: 200,
      owner_id: 10001,
    });
    mockClient.getGroupMemberList.mockResolvedValue([
      { user_id: 1, nickname: '用户1', card: '名片1', role: 'owner' },
      { user_id: 2, nickname: '用户2', card: '', role: 'admin' },
    ]);
    mockClient.getStrangerInfo.mockResolvedValue({ user_id: 999, nickname: '陌生人' });
  });

  it('应查询群信息', async () => {
    const result = await qqInfo(mockClient, { type: 'group', target_id: '123' });
    expect(result.success).toBe(true);
    expect(result.data!.group_name).toBe('测试群');
    expect(result.data!.member_count).toBe(50);
  });

  it('应查询群成员列表', async () => {
    const result = await qqInfo(mockClient, { type: 'members', target_id: '123' });
    expect(result.success).toBe(true);
    expect(result.data!.count).toBe(2);
    expect(result.data!.members[0].user_name).toBe('用户1');
    expect(result.data!.members[1].role).toBe('admin');
  });

  it('应查询用户信息', async () => {
    const result = await qqInfo(mockClient, { type: 'user', target_id: '999' });
    expect(result.success).toBe(true);
    expect(result.data!.user_name).toBe('陌生人');
  });

  it('不支持的查询类型应返回错误', async () => {
    const result = await qqInfo(mockClient, { type: 'invalid' as any, target_id: '123' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('不支持的查询类型');
  });

  it('API 错误应被捕获', async () => {
    mockClient.getGroupInfo.mockRejectedValue(new Error('网络错误'));
    const result = await qqInfo(mockClient, { type: 'group', target_id: '123' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('网络错误');
  });
});