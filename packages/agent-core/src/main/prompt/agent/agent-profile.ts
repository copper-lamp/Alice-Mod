/**
 * AgentProfile 默认实现
 *
 * 管理智能体的身份定义、行为规则和偏好设置。
 * 支持深拷贝、部分更新和序列化。
 */

import type { AgentProfile, BehaviorRules, PromptFragment } from '../types';
import { DEFAULT_AGENT_PROFILE } from '../types';

/**
 * 默认智能体 Profile 管理器
 */
export class DefaultAgentProfile {
  private profile: AgentProfile;

  constructor(initial?: Partial<AgentProfile>) {
    this.profile = this.mergeWithDefault(initial ?? {});
  }

  /** 获取完整 profile */
  get(): AgentProfile {
    return this.deepClone(this.profile);
  }

  /** 更新部分字段 */
  update(partial: Partial<AgentProfile>): void {
    if (partial.name !== undefined) this.profile.name = partial.name;
    if (partial.identity !== undefined) this.profile.identity = partial.identity;
    if (partial.personality !== undefined) this.profile.personality = [...partial.personality];
    if (partial.rules !== undefined) this.profile.rules = this.deepClone(partial.rules);
    if (partial.preferences !== undefined) {
      this.profile.preferences = { ...this.profile.preferences, ...partial.preferences };
    }
    if (partial.fragments !== undefined) {
      this.profile.fragments = partial.fragments.map(f => ({ ...f }));
    }
  }

  /** 添加自定义片段 */
  addFragment(fragment: PromptFragment): void {
    const existing = this.profile.fragments.findIndex(f => f.name === fragment.name);
    if (existing >= 0) {
      this.profile.fragments[existing] = { ...fragment };
    } else {
      this.profile.fragments.push({ ...fragment });
    }
  }

  /** 移除片段 */
  removeFragment(name: string): void {
    this.profile.fragments = this.profile.fragments.filter(f => f.name !== name);
  }

  /** 启用/禁用片段 */
  toggleFragment(name: string, enabled: boolean): void {
    const fragment = this.profile.fragments.find(f => f.name === name);
    if (fragment) {
      fragment.enabled = enabled;
    }
  }

  /** 获取启用的片段 */
  getEnabledFragments(): PromptFragment[] {
    return this.profile.fragments.filter(f => f.enabled);
  }

  /** 序列化为 JSON */
  toJSON(): string {
    return JSON.stringify(this.profile, null, 2);
  }

  /** 从 JSON 反序列化 */
  static fromJSON(json: string): DefaultAgentProfile {
    const data = JSON.parse(json) as AgentProfile;
    return new DefaultAgentProfile(data);
  }

  /** 重置为默认 */
  reset(): void {
    this.profile = this.deepClone(DEFAULT_AGENT_PROFILE);
  }

  private mergeWithDefault(partial: Partial<AgentProfile>): AgentProfile {
    return {
      ...DEFAULT_AGENT_PROFILE,
      ...partial,
      rules: {
        ...DEFAULT_AGENT_PROFILE.rules,
        ...(partial.rules ?? {}),
        core: partial.rules?.core ?? [...DEFAULT_AGENT_PROFILE.rules.core],
        strategy: partial.rules?.strategy
          ? partial.rules.strategy.map(s => ({ ...s }))
          : [...DEFAULT_AGENT_PROFILE.rules.strategy],
        constraints: partial.rules?.constraints
          ? partial.rules.constraints.map(c => ({ ...c }))
          : [...DEFAULT_AGENT_PROFILE.rules.constraints],
      },
      preferences: {
        ...DEFAULT_AGENT_PROFILE.preferences,
        ...(partial.preferences ?? {}),
      },
      fragments: partial.fragments
        ? partial.fragments.map(f => ({ ...f }))
        : [],
    };
  }

  private deepClone<T>(obj: T): T {
    return JSON.parse(JSON.stringify(obj));
  }
}