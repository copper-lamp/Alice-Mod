/**
 * RemoteCommandParser 单元测试
 *
 * 覆盖场景：
 * - /status（自定义与默认）
 * - /task list
 * - /restart
 * - /help
 * - 未知指令
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RemoteCommandParser } from '../../src/main/qq-bot/remote-command-parser';
import type { QQMessage } from '../../src/main/qq-bot/types';

const baseMsg: QQMessage = {
  id: 'm1',
  type: 'private',
  userId: 'u1',
  userName: 'Admin',
  content: '/status',
  rawContent: '/status',
  segments: [],
  timestamp: Date.now(),
  read: false,
};

describe('RemoteCommandParser', () => {
  let parser: RemoteCommandParser;

  beforeEach(() => {
    parser = new RemoteCommandParser();
  });

  it('/status 应使用自定义状态函数', async () => {
    parser.setDeps({ getStatus: () => '在线' });
    const result = await parser.execute('status', '', baseMsg);
    expect(result).toBe('在线');
  });

  it('/status 默认应返回运行状态', async () => {
    const result = await parser.execute('status', '', baseMsg);
    expect(result).toContain('Agent Core 状态');
    expect(result).toContain('运行时间');
  });

  it('/task list 应返回任务列表', async () => {
    parser.setDeps({
      taskManager: {
        list: vi.fn().mockReturnValue({
          tasks: [
            { id: 't1', name: '任务1', priority: 'high', status: 'running', progress: 50 },
            { id: 't2', name: '任务2', priority: 'normal', status: 'pending', progress: 0 },
          ],
          total: 2,
        }),
      } as any,
    });

    const result = await parser.execute('task', 'list', baseMsg);
    expect(result).toContain('最近任务');
    expect(result).toContain('[high] 任务1');
    expect(result).toContain('(50%)');
  });

  it('/task 无子指令应默认 list', async () => {
    parser.setDeps({
      taskManager: {
        list: vi.fn().mockReturnValue({ tasks: [], total: 0 }),
      } as any,
    });

    const result = await parser.execute('task', '', baseMsg);
    expect(result).toBe('📋 当前没有任务');
  });

  it('/task list 任务系统不可用时返回错误', async () => {
    const result = await parser.execute('task', 'list', baseMsg);
    expect(result).toContain('任务系统不可用');
  });

  it('/restart 应返回提示', async () => {
    const result = await parser.execute('restart', '', baseMsg);
    expect(result).toContain('重启指令已收到');
  });

  it('/help 应返回指令列表', async () => {
    const result = await parser.execute('help', '', baseMsg);
    expect(result).toContain('/status');
    expect(result).toContain('/task list');
    expect(result).toContain('/restart');
  });

  it('未知指令应返回 null', async () => {
    const result = await parser.execute('unknown', '', baseMsg);
    expect(result).toBeNull();
  });

  it('指令大小写不敏感', async () => {
    const result = await parser.execute('STATUS', '', baseMsg);
    expect(result).toContain('Agent Core 状态');
  });
});
