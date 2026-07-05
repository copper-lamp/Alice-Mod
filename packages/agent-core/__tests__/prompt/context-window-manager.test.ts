/**
 * 上下文窗口管理器单元测试
 */

import { describe, it, expect } from 'vitest';
import { DefaultContextWindowManager } from '../../src/main/prompt';
import type { ConversationMessage } from '../../src/main/prompt';

function makeMessage(role: ConversationMessage['role'], content: string): ConversationMessage {
  return { role, content };
}

function makeHistory(count: number): ConversationMessage[] {
  const history: ConversationMessage[] = [];
  for (let i = 0; i < count; i++) {
    history.push(makeMessage('user', `用户输入 ${i}`));
    history.push(makeMessage('assistant', `AI 回复 ${i}`));
  }
  return history;
}

describe('DefaultContextWindowManager', () => {
  it('空历史应返回空数组', () => {
    const mgr = new DefaultContextWindowManager();
    const result = mgr.trim([]);
    expect(result).toEqual([]);
  });

  it('在限制内不应裁剪', () => {
    const mgr = new DefaultContextWindowManager({
      historyMaxTokens: 100000,
      keepRecentRounds: 30,
    });
    const history = makeHistory(5);
    const result = mgr.trim(history);
    expect(result).toHaveLength(10); // 5 user + 5 assistant
  });

  it('超出限制应裁剪到指定轮数', () => {
    const mgr = new DefaultContextWindowManager({
      historyMaxTokens: 15, // 很小的限制以触发裁剪
      keepRecentRounds: 2,
    });
    const history = makeHistory(10);
    const result = mgr.trim(history);
    // 应保留最近 2 轮（4 条消息）
    expect(result.length).toBeLessThanOrEqual(6);
  });

  it('应支持 sliding_window 策略', () => {
    const mgr = new DefaultContextWindowManager({
      trimStrategy: 'sliding_window',
      keepRecentRounds: 3,
      historyMaxTokens: 15,
    });
    const history = makeHistory(10);
    const result = mgr.trim(history);
    expect(result.length).toBeGreaterThan(0);
    expect(result.length).toBeLessThan(20);
    // 最近的一条消息应在结果中
    expect(result[result.length - 1].content).toContain('9');
  });

  it('应支持 summary 策略', () => {
    const mgr = new DefaultContextWindowManager({
      trimStrategy: 'summary',
      keepRecentRounds: 2,
      historyMaxTokens: 25,
    });
    const history = makeHistory(10);
    const result = mgr.trim(history);
    // 摘要策略应包含摘要消息
    const summaryMsg = result.find(m => m.content.startsWith('[历史摘要]'));
    expect(summaryMsg).toBeDefined();
  });

  it('应支持 priority 策略', () => {
    const mgr = new DefaultContextWindowManager({
      trimStrategy: 'priority',
      keepRecentRounds: 5,
      historyMaxTokens: 100,
    });
    const history = [
      ...makeHistory(10),
      makeMessage('tool', '工具结果 很长的内容很长的内容很长的内容很长的内容'),
    ];
    const result = mgr.trim(history);
    expect(result.length).toBeGreaterThan(0);
  });

  it('应正确估算 tokens', () => {
    const mgr = new DefaultContextWindowManager();
    const msgs = [makeMessage('user', '你好世界')]; // 4 个中文字符
    const tokens = mgr.estimateTokens(msgs);
    expect(tokens).toBe(1); // ceil(4/4) = 1
  });

  it('估算应包含 tool_calls', () => {
    const mgr = new DefaultContextWindowManager();
    const msgs: ConversationMessage[] = [{
      role: 'assistant',
      content: '',
      tool_calls: [
        { id: '1', type: 'function', function: { name: 'test', arguments: '{}' } },
        { id: '2', type: 'function', function: { name: 'test', arguments: '{}' } },
      ],
    }];
    const tokens = mgr.estimateTokens(msgs);
    expect(tokens).toBe(40); // 2 * 20
  });

  it('应支持更新配置', () => {
    const mgr = new DefaultContextWindowManager();
    mgr.updateConfig({ maxTokens: 64000 });
    const config = mgr.getConfig();
    expect(config.maxTokens).toBe(64000);
  });

  it('应支持构建缓存 key', () => {
    const mgr = new DefaultContextWindowManager();
    const key = mgr.buildCacheKey({
      agentHash: 'abc',
      toolsHash: 'def',
      workspaceId: 'ws-1',
      providerId: 'openai',
    });
    expect(key).toContain('agent:abc');
    expect(key).toContain('tools:def');
    expect(key).toContain('ws:ws-1');
  });
});