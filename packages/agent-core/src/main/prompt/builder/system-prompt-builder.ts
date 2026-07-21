/**
 * 系统提示词构建器 — V19 优化版
 *
 * 精简为 5 区域结构，去掉冗余的通用描述，动态注入用户配置。
 *
 * 区域结构：
 *   [区域1] 你是谁（identity + expertise）
 *   [区域2] 工作流（rules.core）
 *   [区域3] 工作方式（workflowDescription / workApproach）
 *   [区域4] 沟通与边界（communicationStyle + boundaries）
 *   [区域5] 自定义片段（system_begin / system_end）
 */

import type { AgentProfile, ISystemPromptBuilder, IPromptTemplateEngine, PromptFragment } from '../types';
import { DefaultPromptTemplateEngine } from './template-engine';

export class DefaultSystemPromptBuilder implements ISystemPromptBuilder {
  private templateEngine: IPromptTemplateEngine;

  constructor(templateEngine?: IPromptTemplateEngine) {
    this.templateEngine = templateEngine ?? new DefaultPromptTemplateEngine();
  }

  build(profile: AgentProfile, override?: string): string {
    if (override) {
      // 替换 [name] 占位符为实际 agent 名称
      return override.replace(/\[name\]/g, profile.name);
    }

    const parts: string[] = [];

    // ════════════════════════════════════════════════════════════════
    // system_begin 位置的自定义片段
    // ════════════════════════════════════════════════════════════════
    this.addFragmentsByPosition(parts, profile, 'system_begin');

    // ════════════════════════════════════════════════════════════════
    // 区域1: 你是谁（identity + expertise）
    // ════════════════════════════════════════════════════════════════
    parts.push(`# ${profile.name} - 系统提示词\n`);
    parts.push(profile.identity);
    if (profile.expertise && profile.expertise.length > 0) {
      parts.push(`\n擅长：${profile.expertise.join('、')}。`);
    }
    parts.push('\n');

    // ════════════════════════════════════════════════════════════════
    // 区域2: 工作流（rules.core）
    // ════════════════════════════════════════════════════════════════
    if (profile.rules.core.length > 0) {
      parts.push(`## 工作流\n${profile.rules.core.map(r => `- ${r}`).join('\n')}\n`);
    }

    // ════════════════════════════════════════════════════════════════
    // 区域4: 工作方式（workflowDescription / workApproach）
    // ════════════════════════════════════════════════════════════════
    if (profile.workflowDescription) {
      // 优先使用 workflowDescription（由 workflowId 动态生成）
      parts.push(`## 工作方式\n${profile.workflowDescription}\n`);
    } else if (profile.workApproach && profile.workApproach.length > 0) {
      // fallback 到 workApproach（身份模板自带）
      parts.push(`## 工作方式\n${profile.workApproach.join('\n')}\n`);
    }

    // ════════════════════════════════════════════════════════════════
    // 区域5: 沟通与边界（communicationStyle + boundaries）
    // ════════════════════════════════════════════════════════════════
    if (profile.communicationStyle && profile.communicationStyle.length > 0) {
      parts.push(`## 沟通方式\n${profile.communicationStyle.map(c => `- ${c}`).join('\n')}\n`);
    }
    if (profile.boundaries && profile.boundaries.length > 0) {
      parts.push(`## 行为边界\n${profile.boundaries.map(b => `- ${b}`).join('\n')}\n`);
    }

    // ════════════════════════════════════════════════════════════════
    // system_end 位置的自定义片段
    // ════════════════════════════════════════════════════════════════
    this.addFragmentsByPosition(parts, profile, 'system_end');

    return parts.join('\n');
  }

  /**
   * 添加指定位置的自定义片段
   */
  private addFragmentsByPosition(
    parts: string[],
    profile: AgentProfile,
    position: PromptFragment['position'],
  ): void {
    const fragments = profile.fragments.filter(
      f => f.enabled && f.position === position,
    );
    for (const fragment of fragments) {
      const rendered = this.renderFragment(fragment, profile);
      if (rendered) parts.push(rendered);
    }
  }

  private renderFragment(fragment: PromptFragment, profile: AgentProfile): string {
    const variables: Record<string, unknown> = {
      agent: {
        name: profile.name,
        identity: profile.identity,
        personality: profile.personality,
        preferences: profile.preferences,
        communicationStyle: profile.communicationStyle,
        workApproach: profile.workApproach,
        boundaries: profile.boundaries,
        securityRules: profile.securityRules,
        toolDiscipline: profile.toolDiscipline,
      },
    };
    return this.templateEngine.render(fragment.template, variables);
  }
}