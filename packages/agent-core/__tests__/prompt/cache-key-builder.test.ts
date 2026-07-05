/**
 * 缓存 key 构建器单元测试
 */

import { describe, it, expect } from 'vitest';
import { DefaultCacheKeyBuilder } from '../../src/main/prompt';
import { DEFAULT_AGENT_PROFILE } from '../../src/main/prompt';
import type { ToolPromptDefinition, AgentProfile } from '../../src/main/prompt';

describe('DefaultCacheKeyBuilder', () => {
  const builder = new DefaultCacheKeyBuilder();

  it('相同配置应生成相同的 agent hash', () => {
    const h1 = builder.hashAgentProfile(DEFAULT_AGENT_PROFILE);
    const h2 = builder.hashAgentProfile(DEFAULT_AGENT_PROFILE);
    expect(h1).toBe(h2);
  });

  it('不同配置应生成不同的 agent hash', () => {
    const modified: AgentProfile = {
      ...DEFAULT_AGENT_PROFILE,
      name: 'DifferentBot',
    };
    const h1 = builder.hashAgentProfile(DEFAULT_AGENT_PROFILE);
    const h2 = builder.hashAgentProfile(modified);
    expect(h1).not.toBe(h2);
  });

  it('相同工具列表应生成相同的 tools hash', () => {
    const tools: ToolPromptDefinition[] = [
      { name: 'move_to', description: '移动', category: 'movement', priority: 1, parameters: {} },
      { name: 'dig_block', description: '挖掘', category: 'block', priority: 2, parameters: {} },
    ];
    const h1 = builder.hashToolDefinitions(tools);
    const h2 = builder.hashToolDefinitions(tools);
    expect(h1).toBe(h2);
  });

  it('不同工具列表应生成不同的 tools hash', () => {
    const tools1: ToolPromptDefinition[] = [
      { name: 'move_to', description: '移动', category: 'movement', priority: 1, parameters: {} },
    ];
    const tools2: ToolPromptDefinition[] = [
      { name: 'dig_block', description: '挖掘', category: 'block', priority: 2, parameters: {} },
    ];
    const h1 = builder.hashToolDefinitions(tools1);
    const h2 = builder.hashToolDefinitions(tools2);
    expect(h1).not.toBe(h2);
  });

  it('build 应返回分层的缓存 key', () => {
    const parts = builder.build({
      agentHash: 'abc123',
      toolsHash: 'def456',
      workspaceId: 'ws-1',
      providerId: 'openai',
    });

    expect(parts.staticPrefix).toBe('cache:agent:abc123:system');
    expect(parts.toolDefinitions).toBe('cache:agent:abc123:tools:def456');
    expect(parts.full).toContain('ws:ws-1');
    expect(parts.full).toContain('provider:openai');
  });

  it('完整缓存 key 应包含所有维度', () => {
    const parts = builder.build({
      agentHash: 'abc',
      toolsHash: 'def',
      workspaceId: 'ws-1',
      providerId: 'openai',
      dimensions: { version: '1.0' },
    });

    expect(parts.full).toContain('version:1.0');
  });

  it('hash 应始终为正整数', () => {
    const h = builder.hashString('测试字符串');
    expect(Number.isNaN(Number(h))).toBe(false);
    expect(h.length).toBeGreaterThan(0);
  });

  it('fragments 的顺序不应影响 hash', () => {
    const profile1: AgentProfile = {
      ...DEFAULT_AGENT_PROFILE,
      fragments: [
        { name: 'a', template: 'A', position: 'system_end', enabled: true },
        { name: 'b', template: 'B', position: 'system_end', enabled: true },
      ],
    };
    const profile2: AgentProfile = {
      ...DEFAULT_AGENT_PROFILE,
      fragments: [
        { name: 'b', template: 'B', position: 'system_end', enabled: true },
        { name: 'a', template: 'A', position: 'system_end', enabled: true },
      ],
    };
    const h1 = builder.hashAgentProfile(profile1);
    const h2 = builder.hashAgentProfile(profile2);
    expect(h1).toBe(h2);
  });

  it('禁用的片段不应影响 hash', () => {
    const profile1: AgentProfile = {
      ...DEFAULT_AGENT_PROFILE,
      fragments: [
        { name: 'x', template: 'X', position: 'system_end', enabled: true },
      ],
    };
    const profile2: AgentProfile = {
      ...DEFAULT_AGENT_PROFILE,
      fragments: [
        { name: 'x', template: 'X', position: 'system_end', enabled: false },
      ],
    };
    const h1 = builder.hashAgentProfile(profile1);
    const h2 = builder.hashAgentProfile(profile2);
    expect(h1).not.toBe(h2);
  });
});