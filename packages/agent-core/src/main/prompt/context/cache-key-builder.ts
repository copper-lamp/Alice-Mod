/**
 * 缓存 key 构建器
 *
 * 构建分层的缓存 key，支持多级缓存粒度：
 *   Level 1: cache:agent:{agentHash} — 系统提示词（跨工作区共享）
 *   Level 2: cache:agent:{agentHash}:tools:{toolsHash} — 系统提示词 + 工具定义
 *   Level 3: ...:ws:{workspaceId}:provider:{providerId} — 完整缓存
 *
 * 确保相同配置的智能体生成相同的 hash，最大化缓存命中率。
 */

import type { AgentProfile, ToolPromptDefinition, CacheKeyContext, CacheKeyParts, ICacheKeyBuilder } from '../types';

export class DefaultCacheKeyBuilder implements ICacheKeyBuilder {
  build(context: CacheKeyContext): CacheKeyParts {
    const staticPrefix = `cache:agent:${context.agentHash}:system`;
    const toolDefinitions = `cache:agent:${context.agentHash}:tools:${context.toolsHash}`;

    let full = `cache:agent:${context.agentHash}:tools:${context.toolsHash}:ws:${context.workspaceId}:provider:${context.providerId}`;

    if (context.dimensions) {
      const dims = Object.entries(context.dimensions)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}:${v}`)
        .join(':');
      full += `:${dims}`;
    }

    return { staticPrefix, toolDefinitions, full };
  }

  hashAgentProfile(profile: AgentProfile): string {
    const normalized = {
      name: profile.name,
      identity: profile.identity,
      personality: [...profile.personality].sort(),
      coreRules: [...profile.rules.core].sort(),
      strategyRules: [...profile.rules.strategy]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(r => ({ name: r.name, description: r.description, priority: r.priority })),
      constraints: [...profile.rules.constraints]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(c => ({ name: c.name, description: c.description, consequence: c.consequence })),
      preferences: profile.preferences,
      fragments: [...profile.fragments]
        .filter(f => f.enabled)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(f => ({ name: f.name, template: f.template, position: f.position })),
    };

    return this.hashString(JSON.stringify(normalized));
  }

  hashToolDefinitions(tools: ToolPromptDefinition[]): string {
    const normalized = tools
      .map(t => ({
        name: t.name,
        category: t.category,
        description: t.description,
        paramNames: Object.keys(t.parameters).sort(),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return this.hashString(JSON.stringify(normalized));
  }

  hashString(input: string): string {
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      const char = input.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString();
  }
}