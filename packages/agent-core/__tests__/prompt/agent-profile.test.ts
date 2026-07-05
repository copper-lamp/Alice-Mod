/**
 * AgentProfile 单元测试
 */

import { describe, it, expect } from 'vitest';
import { DefaultAgentProfile, BehaviorRulesManager, PromptFragmentManager } from '../../src/main/prompt';
import { DEFAULT_AGENT_PROFILE } from '../../src/main/prompt';

describe('DefaultAgentProfile', () => {
  it('应使用默认配置创建', () => {
    const profile = new DefaultAgentProfile();
    const p = profile.get();
    expect(p.name).toBe('McAgent');
    expect(p.identity).toContain('Minecraft');
    expect(p.personality).toHaveLength(3);
    expect(p.rules.core).toHaveLength(4);
  });

  it('应支持部分更新', () => {
    const profile = new DefaultAgentProfile();
    profile.update({ name: 'BuilderBot', identity: '我是一个建筑机器人' });
    const p = profile.get();
    expect(p.name).toBe('BuilderBot');
    expect(p.identity).toBe('我是一个建筑机器人');
    // 未更新的应保持不变
    expect(p.personality).toHaveLength(3);
  });

  it('应支持添加自定义片段', () => {
    const profile = new DefaultAgentProfile();
    profile.addFragment({
      name: 'test_fragment',
      template: '这是测试片段',
      position: 'system_end',
      enabled: true,
    });
    const p = profile.get();
    expect(p.fragments).toHaveLength(1);
    expect(p.fragments[0].name).toBe('test_fragment');
  });

  it('添加同名片段应覆盖', () => {
    const profile = new DefaultAgentProfile();
    profile.addFragment({
      name: 'test', template: 'v1', position: 'system_end', enabled: true,
    });
    profile.addFragment({
      name: 'test', template: 'v2', position: 'system_end', enabled: true,
    });
    const p = profile.get();
    expect(p.fragments).toHaveLength(1);
    expect(p.fragments[0].template).toBe('v2');
  });

  it('应支持移除片段', () => {
    const profile = new DefaultAgentProfile();
    profile.addFragment({
      name: 'test', template: 'xxx', position: 'system_end', enabled: true,
    });
    profile.removeFragment('test');
    expect(profile.get().fragments).toHaveLength(0);
  });

  it('应支持启用/禁用片段', () => {
    const profile = new DefaultAgentProfile();
    profile.addFragment({
      name: 'test', template: 'xxx', position: 'system_end', enabled: true,
    });
    profile.toggleFragment('test', false);
    expect(profile.getEnabledFragments()).toHaveLength(0);
  });

  it('应支持序列化和反序列化', () => {
    const profile = new DefaultAgentProfile({ name: 'TestBot' });
    const json = profile.toJSON();
    const restored = DefaultAgentProfile.fromJSON(json);
    expect(restored.get().name).toBe('TestBot');
  });

  it('应支持重置为默认', () => {
    const profile = new DefaultAgentProfile({ name: 'CustomBot' });
    profile.reset();
    expect(profile.get().name).toBe('McAgent');
  });
});

describe('BehaviorRulesManager', () => {
  it('应支持添加核心规则', () => {
    const mgr = new BehaviorRulesManager();
    mgr.addCoreRule('测试规则');
    const rules = mgr.get();
    expect(rules.core).toContain('测试规则');
  });

  it('应支持添加策略规则', () => {
    const mgr = new BehaviorRulesManager();
    mgr.addStrategy({ name: 'test', description: '测试策略', priority: 5 });
    const rules = mgr.get();
    expect(rules.strategy).toHaveLength(1);
    expect(rules.strategy[0].name).toBe('test');
  });

  it('同名策略规则应覆盖', () => {
    const mgr = new BehaviorRulesManager();
    mgr.addStrategy({ name: 's1', description: 'v1', priority: 1 });
    mgr.addStrategy({ name: 's1', description: 'v2', priority: 2 });
    const rules = mgr.get();
    expect(rules.strategy).toHaveLength(1);
    expect(rules.strategy[0].description).toBe('v2');
  });

  it('应支持添加约束规则', () => {
    const mgr = new BehaviorRulesManager();
    mgr.addConstraint({ name: 'c1', description: '测试约束', consequence: 'block' });
    const rules = mgr.get();
    expect(rules.constraints).toHaveLength(1);
  });

  it('应格式化核心规则', () => {
    const mgr = new BehaviorRulesManager({ core: ['规则1', '规则2'], strategy: [], constraints: [] });
    const formatted = mgr.formatCoreRules();
    expect(formatted).toContain('规则1');
    expect(formatted).toContain('规则2');
  });

  it('应验证规则', () => {
    const mgr = new BehaviorRulesManager();
    mgr.addStrategy({ name: '', description: '', priority: 0 });
    const errors = mgr.validate();
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe('PromptFragmentManager', () => {
  it('应支持注册和获取片段', () => {
    const mgr = new PromptFragmentManager();
    mgr.register({
      name: 'f1', template: 'test', position: 'system_end', enabled: true,
    });
    expect(mgr.get('f1')).toBeDefined();
    expect(mgr.count).toBe(1);
  });

  it('应支持按位置获取', () => {
    const mgr = new PromptFragmentManager();
    mgr.register({ name: 'f1', template: 't1', position: 'system_begin', enabled: true });
    mgr.register({ name: 'f2', template: 't2', position: 'system_end', enabled: true });
    expect(mgr.getByPosition('system_begin')).toHaveLength(1);
    expect(mgr.getByPosition('system_end')).toHaveLength(1);
  });

  it('禁用后不应出现在已启用列表', () => {
    const mgr = new PromptFragmentManager();
    mgr.register({ name: 'f1', template: 't1', position: 'system_end', enabled: true });
    mgr.toggle('f1', false);
    expect(mgr.getEnabled()).toHaveLength(0);
  });
});