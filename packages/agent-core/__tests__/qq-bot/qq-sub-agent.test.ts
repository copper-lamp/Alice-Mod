/**
 * QQSubAgent 测试
 *
 * 覆盖：启动/停止、消息处理、LLM 调用、工具执行、事件系统、对话管理
 * 注意：LLM 调用被 mock，测试关注逻辑流程而非 LLM 输出
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { QQSubAgent } from '../../src/main/qq-bot/qq-sub-agent';
import { mainAgentTaskQueue } from '../../src/main/qq-bot/main-agent-queue';
import type { QQMessage, GameActionResult } from '../../src/main/qq-bot/types';

describe('QQSubAgent', () => {
  let subAgent: QQSubAgent;
  let mockResolve: ReturnType<typeof vi.fn>;
  let mockGetProvider: ReturnType<typeof vi.fn>;
  let mockProvider: { chat: ReturnType<typeof vi.fn> };

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

    mockResolve = vi.fn().mockResolvedValue({
      providerId: 'test-provider',
      model: 'test-model',
      options: {},
    });

    mockProvider = {
      chat: vi.fn().mockResolvedValue({
        message: {
          role: 'assistant',
          content: '你好！有什么可以帮你的吗？',
        },
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
  });

  // ── 生命周期 ──

  it('start 应初始化对话', async () => {
    await subAgent.start();
    expect(subAgent.getStatus()).toBe('idle');
    expect(subAgent.getConversation()).toHaveLength(1);
    expect(subAgent.getConversation()[0].role).toBe('system');
  });

  it('stop 应清理资源', async () => {
    await subAgent.start();
    await subAgent.stop();
    expect(subAgent.getConversation()).toHaveLength(0);
  });

  // ── 消息处理 ──

  it('应处理消息并调用 LLM', async () => {
    await subAgent.start();

    const events: any[] = [];
    subAgent.onEvent(e => events.push(e));

    await subAgent.handleMessage(mockMsg());

    // 应调用 LLM
    expect(mockProvider.chat).toHaveBeenCalledTimes(1);
    expect(mockResolve).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'qq_sub_agent',
      requiresTools: true,
    }));

    // 应发出回复事件
    expect(events.some(e => e.type === 'reply')).toBe(true);
    const reply = events.find(e => e.type === 'reply');
    expect(reply.reply.content).toBe('你好！有什么可以帮你的吗？');
  });

  it('应记录对话历史', async () => {
    await subAgent.start();

    await subAgent.handleMessage(mockMsg({ content: '第一轮' }));
    expect(subAgent.getConversation().length).toBeGreaterThanOrEqual(3); // system + user + assistant

    // 第二轮
    mockProvider.chat.mockResolvedValueOnce({
      message: { role: 'assistant', content: '第二轮回复' },
      usage: { promptTokens: 60, completionTokens: 10, totalTokens: 70 },
      model: 'test-model',
      requestId: 'req_002',
      durationMs: 100,
      truncated: false,
      finishReason: 'stop',
    });

    await subAgent.handleMessage(mockMsg({ content: '第二轮' }));
    const history = subAgent.getConversation();
    expect(history.filter(m => m.role === 'user').length).toBe(2);
    expect(history.filter(m => m.role === 'assistant').length).toBe(2);
  });

  // ── 工具调用 ──

  it('应处理工具调用并继续对话', async () => {
    await subAgent.start();

    // LLM 返回工具调用
    mockProvider.chat.mockResolvedValueOnce({
      message: {
        role: 'assistant',
        content: '',
        tool_calls: [{
          toolCallId: 'call_001',
          toolName: 'request_game_action',
          arguments: { description: '查询背包' },
        }],
      },
      usage: { promptTokens: 60, completionTokens: 10, totalTokens: 70 },
      model: 'test-model',
      requestId: 'req_002',
      durationMs: 100,
      truncated: false,
      finishReason: 'tool_calls',
    });

    // 第二次调用（工具结果后）
    mockProvider.chat.mockResolvedValueOnce({
      message: { role: 'assistant', content: '你的背包里有钻石 x5' },
      usage: { promptTokens: 70, completionTokens: 15, totalTokens: 85 },
      model: 'test-model',
      requestId: 'req_003',
      durationMs: 100,
      truncated: false,
      finishReason: 'stop',
    });

    const events: any[] = [];
    subAgent.onEvent(e => events.push(e));

    // 提交一个 fake 请求到队列，让 submit 能 resolve
    const req = {
      id: expect.stringMatching(/^req_/),
      sourceUserId: 'qq_sub_agent',
      description: '查询背包',
      priority: 'normal' as const,
      timestamp: expect.any(Number),
    };

    // 手动完成队列中的请求
    setTimeout(() => {
      const polled = mainAgentTaskQueue.poll();
      if (polled) {
        mainAgentTaskQueue.complete(polled.id, {
          requestId: polled.id,
          success: true,
          summary: '背包有钻石 x5',
          durationMs: 200,
        });
      }
    }, 50);

    await subAgent.handleMessage(mockMsg({ content: '帮我看看背包' }));

    // 最终应回复工具结果
    const reply = events.find(e => e.type === 'reply');
    expect(reply).toBeDefined();
    expect(reply.reply.content).toBe('你的背包里有钻石 x5');
  });

  it('应处理 qq_send 工具调用', async () => {
    await subAgent.start();

    // LLM 返回 qq_send 工具调用
    mockProvider.chat.mockResolvedValueOnce({
      message: {
        role: 'assistant',
        content: '',
        tool_calls: [{
          toolCallId: 'call_send',
          toolName: 'qq_send',
          arguments: { type: 'group_msg', target: 'group_001', content: '你好' },
        }],
      },
      usage: { promptTokens: 50, completionTokens: 10, totalTokens: 60 },
      model: 'test-model',
      requestId: 'req_send',
      durationMs: 100,
      truncated: false,
      finishReason: 'tool_calls',
    });

    // 第二次调用（工具结果后）
    mockProvider.chat.mockResolvedValueOnce({
      message: { role: 'assistant', content: '消息已发送' },
      usage: { promptTokens: 70, completionTokens: 15, totalTokens: 85 },
      model: 'test-model',
      requestId: 'req_send_2',
      durationMs: 100,
      truncated: false,
      finishReason: 'stop',
    });

    const events: any[] = [];
    subAgent.onEvent(e => events.push(e));

    await subAgent.handleMessage(mockMsg({ content: '发消息' }));

    // 应发出 reply 事件（工具执行时 emit）
    const replyEvent = events.find(e => e.type === 'reply' && e.reply.content === '消息已发送');
    expect(replyEvent).toBeDefined();
  });

  it('应处理 qq_info 工具调用', async () => {
    await subAgent.start();

    mockProvider.chat.mockResolvedValueOnce({
      message: {
        role: 'assistant',
        content: '',
        tool_calls: [{
          toolCallId: 'call_info',
          toolName: 'qq_info',
          arguments: { type: 'group', target_id: '123' },
        }],
      },
      usage: { promptTokens: 50, completionTokens: 10, totalTokens: 60 },
      model: 'test-model',
      requestId: 'req_info',
      durationMs: 100,
      truncated: false,
      finishReason: 'tool_calls',
    });

    mockProvider.chat.mockResolvedValueOnce({
      message: { role: 'assistant', content: '查询已完成' },
      usage: { promptTokens: 70, completionTokens: 15, totalTokens: 85 },
      model: 'test-model',
      requestId: 'req_info_2',
      durationMs: 100,
      truncated: false,
      finishReason: 'stop',
    });

    const events: any[] = [];
    subAgent.onEvent(e => events.push(e));

    await subAgent.handleMessage(mockMsg({ content: '查群信息' }));

    const replyEvent = events.find(e => e.type === 'reply' && e.reply.content === '查询已完成');
    expect(replyEvent).toBeDefined();
  });

  it('应处理未知工具调用', async () => {
    await subAgent.start();

    mockProvider.chat.mockResolvedValueOnce({
      message: {
        role: 'assistant',
        content: '',
        tool_calls: [{
          toolCallId: 'call_unknown',
          toolName: 'unknown_tool',
          arguments: {},
        }],
      },
      usage: { promptTokens: 50, completionTokens: 10, totalTokens: 60 },
      model: 'test-model',
      requestId: 'req_unknown',
      durationMs: 100,
      truncated: false,
      finishReason: 'tool_calls',
    });

    // 第二次调用（工具结果后）
    mockProvider.chat.mockResolvedValueOnce({
      message: { role: 'assistant', content: '未知工具调用' },
      usage: { promptTokens: 60, completionTokens: 10, totalTokens: 70 },
      model: 'test-model',
      requestId: 'req_unknown_2',
      durationMs: 100,
      truncated: false,
      finishReason: 'stop',
    });

    const events: any[] = [];
    subAgent.onEvent(e => events.push(e));

    await subAgent.handleMessage(mockMsg({ content: '测试未知工具' }));

    // 应仍能回复（即使工具失败）
    const replyEvent = events.find(e => e.type === 'reply');
    expect(replyEvent).toBeDefined();
  });

  it('Provider 不可用时应报错', async () => {
    const badAgent = new QQSubAgent(
      { resolve: mockResolve } as any,
      vi.fn().mockReturnValue(undefined) as any, // getProvider returns undefined
      { enabled: true },
    );

    await badAgent.start();

    const events: any[] = [];
    badAgent.onEvent(e => events.push(e));

    await badAgent.handleMessage(mockMsg({ content: '测试' }));

    // 应回复错误消息
    const replyEvent = events.find(e => e.type === 'reply');
    expect(replyEvent).toBeDefined();
    expect(replyEvent.reply.content).toContain('出了点问题');
  });

  it('request_game_action 队列拒绝时应返回错误', async () => {
    await subAgent.start();

    mockProvider.chat.mockResolvedValueOnce({
      message: {
        role: 'assistant',
        content: '',
        tool_calls: [{
          toolCallId: 'call_reject',
          toolName: 'request_game_action',
          arguments: { description: '被拒绝的操作' },
        }],
      },
      usage: { promptTokens: 50, completionTokens: 10, totalTokens: 60 },
      model: 'test-model',
      requestId: 'req_reject',
      durationMs: 100,
      truncated: false,
      finishReason: 'tool_calls',
    });

    mockProvider.chat.mockResolvedValueOnce({
      message: { role: 'assistant', content: '操作被拒绝' },
      usage: { promptTokens: 60, completionTokens: 10, totalTokens: 70 },
      model: 'test-model',
      requestId: 'req_reject_2',
      durationMs: 100,
      truncated: false,
      finishReason: 'stop',
    });

    // 先填满全局队列的并发限制，让 submit 被拒绝
    // 先提交一个请求但不 poll（占用并发槽位? 不，submit 只是添加到队列，不会占用 processing 槽位）
    // 实际上 submit 不会因为 concurrent limit 拒绝，而是 poll 时不返回。
    // 为了让 submit 直接失败，我们可以利用"同一用户并发限制"：先提交一个同用户请求
    const blockingReq = {
      id: 'blocking_req',
      sourceUserId: 'qq_sub_agent',
      description: '阻塞请求',
      priority: 'normal' as const,
      timestamp: Date.now(),
    };

    // 提交一个阻塞请求（不 poll，所以它一直 pending）
    // 但 submit 的用户并发限制检查的是同 sourceUserId 的非 completed 条目
    // 所以第二个相同 sourceUserId 的 submit 会被拒绝
    mainAgentTaskQueue.submit(blockingReq);

    const events: any[] = [];
    subAgent.onEvent(e => events.push(e));

    await subAgent.handleMessage(mockMsg({ content: '拒绝测试' }));

    const replyEvent = events.find(e => e.type === 'reply');
    expect(replyEvent).toBeDefined();
  });

  // ── 事件系统 ──

  it('应支持事件注册和取消', async () => {
    await subAgent.start();

    const handler = vi.fn();
    const unsubscribe = subAgent.onEvent(handler);

    await subAgent.handleMessage(mockMsg());
    expect(handler).toHaveBeenCalled();

    handler.mockClear();
    unsubscribe();
    await subAgent.handleMessage(mockMsg());
    // 取消后不再调用
    expect(handler).not.toHaveBeenCalled();
  });

  it('应报告状态变化', async () => {
    await subAgent.start();

    const events: any[] = [];
    subAgent.onEvent(e => {
      if (e.type === 'status_change') events.push(e);
    });

    await subAgent.handleMessage(mockMsg());
    expect(events.some(e => e.status === 'thinking')).toBe(true);
    expect(events.some(e => e.status === 'idle')).toBe(true);
  });

  // ── 错误处理 ──

  it('LLM 调用失败应回复错误消息', async () => {
    await subAgent.start();

    mockProvider.chat.mockRejectedValue(new Error('API 调用失败'));

    const events: any[] = [];
    subAgent.onEvent(e => events.push(e));

    await subAgent.handleMessage(mockMsg());

    const reply = events.find(e => e.type === 'reply');
    expect(reply).toBeDefined();
    expect(reply.reply.content).toContain('出了点问题');
  });

  it('禁用时不应处理消息', async () => {
    const disabledAgent = new QQSubAgent(
      { resolve: mockResolve } as any,
      mockGetProvider as any,
      { enabled: false },
    );

    await disabledAgent.start();
    await disabledAgent.handleMessage(mockMsg());

    expect(mockProvider.chat).not.toHaveBeenCalled();
  });

  // ── 对话管理 ──

  it('clearConversation 应清空历史', async () => {
    await subAgent.start();
    await subAgent.handleMessage(mockMsg());

    expect(subAgent.getConversation().length).toBeGreaterThan(1);

    subAgent.clearConversation();
    expect(subAgent.getConversation()).toHaveLength(0);
  });

  it('应裁剪超出历史的对话', async () => {
    const smallAgent = new QQSubAgent(
      { resolve: mockResolve } as any,
      mockGetProvider as any,
      { maxHistoryRounds: 1, enabled: true },
    );

    await smallAgent.start();

    // 发送多轮消息
    for (let i = 0; i < 5; i++) {
      mockProvider.chat.mockResolvedValueOnce({
        message: { role: 'assistant', content: `回复${i}` },
        usage: { promptTokens: 50, completionTokens: 10, totalTokens: 60 },
        model: 'test-model',
        requestId: `req_${i}`,
        durationMs: 100,
        truncated: false,
        finishReason: 'stop',
      });
      await smallAgent.handleMessage(mockMsg({ content: `消息${i}` }));
    }

    // 对话应被裁剪（保留 system + 最近的 1 轮）
    expect(smallAgent.getConversation().length).toBeLessThanOrEqual(4); // system + user + assistant + tool = 最多 4 条
  });
});