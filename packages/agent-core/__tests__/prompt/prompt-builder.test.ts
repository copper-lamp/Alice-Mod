/**
 * PromptBuilder 单元测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PromptBuilder, DEFAULT_AGENT_PROFILE } from '../../src/main/prompt';
import type { BuildParams, AgentProfile, PromptFragment, PlayerState, ConversationMessage } from '../../src/main/prompt';

const mockState: PlayerState = {
  health: 20,
  hunger: 18,
  saturation: 5,
  position: { x: 100, y: 64, z: 200, dimension: 'overworld', biome: 'plains' },
  equipment: { mainhand: '铁镐' },
  inventory: { usedSlots: 10, totalSlots: 36, items: ['圆石 x32', '木棍 x4'] },
  statusEffects: [],
};

const baseParams: BuildParams = {
  workspaceId: 'ws-1',
  userInput: '帮我收集一些圆石',
  history: [],
  state: mockState,
  source: 'user',
};

describe('PromptBuilder', () => {
  let builder: PromptBuilder;

  beforeEach(() => {
    builder = new PromptBuilder();
  });

  it('应构建完整消息列表', async () => {
    const result = await builder.build(baseParams);

    expect(result.messages).toHaveLength(2); // system + user
    expect(result.messages[0].role).toBe('system');
    expect(result.messages[1].role).toBe('user');
    expect(result.tools).toBeDefined();
    expect(result.cache).toBeDefined();
    expect(result.tokenBreakdown).toBeDefined();
  });

  it('系统提示词应包含智能体名称', async () => {
    const result = await builder.build(baseParams);
    const systemMsg = result.messages[0].content;
    expect(systemMsg).toContain('McAgent');
  });

  it('状态注入应出现在 user message 前缀', async () => {
    const result = await builder.build(baseParams);
    const userMsg = result.messages[1].content;
    expect(userMsg).toContain('生命: 20/20');
    expect(userMsg).toContain('饥饿: 18/20');
    expect(userMsg).toContain('位置: (100, 64, 200)');
  });

  it('systemOverride 应覆盖系统提示词', async () => {
    const result = await builder.build({
      ...baseParams,
      systemOverride: '自定义系统提示词',
    });
    const systemMsg = result.messages[0].content;
    expect(systemMsg).toBe('自定义系统提示词');
    expect(systemMsg).not.toContain('McAgent');
  });

  it('对话历史应被包含在消息中', async () => {
    const history: ConversationMessage[] = [
      { role: 'user', content: '之前的问题' },
      { role: 'assistant', content: '之前的回复' },
    ];
    const result = await builder.build({ ...baseParams, history });
    expect(result.messages).toHaveLength(4); // system + 2 history + user
    expect(result.messages[1].content).toContain('之前的问题');
    expect(result.messages[2].content).toContain('之前的回复');
  });

  it('缓存 key 应基于智能体配置变化', async () => {
    const result1 = await builder.build(baseParams);
    builder.updateProfile({ name: 'AnotherBot' });
    const result2 = await builder.build(baseParams);

    expect(result1.cache.key).not.toBe(result2.cache.key);
  });

  it('相同配置应命中缓存', async () => {
    const result1 = await builder.build(baseParams);
    // 首次构建一定是 miss
    expect(result1.cacheHit).toBe(false);

    const result2 = await builder.build(baseParams);
    // 第二次相同配置应命中（lastCacheKey 相同）
    expect(result2.cache.key).toBe(result1.cache.key);
  });

  it('自定义片段应出现在系统提示词中', async () => {
    builder.registerFragment({
      name: 'specialty',
      template: '## 专长\n- 建筑',
      position: 'system_end',
      enabled: true,
    });

    const result = await builder.build(baseParams);
    const systemMsg = result.messages[0].content;
    expect(systemMsg).toContain('专长');
    expect(systemMsg).toContain('建筑');
  });

  it('updateProfile 应更新智能体定义', async () => {
    builder.updateProfile({ name: 'BuilderBot' });
    const profile = builder.getProfile();
    expect(profile.name).toBe('BuilderBot');
  });

  it('getCacheStats 应返回统计信息', async () => {
    await builder.build(baseParams);
    const stats = builder.getCacheStats();
    expect(stats.totalBuilds).toBe(1);
    expect(stats.cacheMisses).toBe(1);
    expect(stats.cacheHits).toBe(0);
  });

  it('token 统计应包含所有分类', async () => {
    const result = await builder.build(baseParams);
    const breakdown = result.tokenBreakdown;
    expect(breakdown.systemPrompt).toBeGreaterThan(0);
    expect(breakdown.stateInjection).toBeGreaterThan(0);
    expect(breakdown.toolDefinitions).toBeGreaterThanOrEqual(0);
    expect(breakdown.userInput).toBeGreaterThan(0);
  });

  it('应包含工具定义', async () => {
    const result = await builder.build(baseParams);
    expect(Array.isArray(result.tools)).toBe(true);
  });

  it('extraContext 应影响缓存 key', async () => {
    const result1 = await builder.build(baseParams);
    const result2 = await builder.build({
      ...baseParams,
      extraContext: { providerId: 'claude' },
    });
    // 不同 provider 应有不同的缓存 key
    expect(result1.cache.key).not.toBe(result2.cache.key);
  });
});