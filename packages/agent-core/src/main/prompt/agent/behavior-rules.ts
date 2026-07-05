/**
 * BehaviorRules 管理
 *
 * 提供行为规则的验证、格式化和查询功能。
 */

import type { BehaviorRules, StrategyRule, ConstraintRule } from '../types';

/**
 * 行为规则管理器
 */
export class BehaviorRulesManager {
  private rules: BehaviorRules;

  constructor(rules?: BehaviorRules) {
    this.rules = rules ?? { core: [], strategy: [], constraints: [] };
  }

  /** 获取规则 */
  get(): BehaviorRules {
    return {
      core: [...this.rules.core],
      strategy: this.rules.strategy.map(s => ({ ...s })),
      constraints: this.rules.constraints.map(c => ({ ...c })),
    };
  }

  /** 更新规则 */
  update(partial: Partial<BehaviorRules>): void {
    if (partial.core !== undefined) this.rules.core = [...partial.core];
    if (partial.strategy !== undefined) this.rules.strategy = partial.strategy.map(s => ({ ...s }));
    if (partial.constraints !== undefined) this.rules.constraints = partial.constraints.map(c => ({ ...c }));
  }

  /** 添加核心规则 */
  addCoreRule(rule: string): void {
    if (!this.rules.core.includes(rule)) {
      this.rules.core.push(rule);
    }
  }

  /** 添加策略规则 */
  addStrategy(rule: StrategyRule): void {
    const existing = this.rules.strategy.findIndex(s => s.name === rule.name);
    if (existing >= 0) {
      this.rules.strategy[existing] = { ...rule };
    } else {
      this.rules.strategy.push({ ...rule });
    }
  }

  /** 添加约束规则 */
  addConstraint(rule: ConstraintRule): void {
    const existing = this.rules.constraints.findIndex(c => c.name === rule.name);
    if (existing >= 0) {
      this.rules.constraints[existing] = { ...rule };
    } else {
      this.rules.constraints.push({ ...rule });
    }
  }

  /** 获取格式化的核心规则文本 */
  formatCoreRules(): string {
    if (this.rules.core.length === 0) return '';
    return this.rules.core.map(r => `- ${r}`).join('\n');
  }

  /** 获取格式化的策略规则文本（按优先级排序） */
  formatStrategyRules(): string {
    if (this.rules.strategy.length === 0) return '';
    const sorted = [...this.rules.strategy].sort((a, b) => b.priority - a.priority);
    return sorted.map(r => `- ${r.description}`).join('\n');
  }

  /** 获取格式化的约束规则文本 */
  formatConstraints(): string {
    if (this.rules.constraints.length === 0) return '';
    const consequenceMap: Record<string, string> = {
      block: '阻止操作',
      replan: '重新规划',
      warning: '警告',
    };
    return this.rules.constraints
      .map(c => `- ${c.description}（违背后果：${consequenceMap[c.consequence] || c.consequence}）`)
      .join('\n');
  }

  /** 验证规则 */
  validate(): string[] {
    const errors: string[] = [];
    for (const strategy of this.rules.strategy) {
      if (!strategy.name) errors.push('策略规则缺少 name');
      if (!strategy.description) errors.push(`策略规则 "${strategy.name || 'unknown'}" 缺少 description`);
    }
    for (const constraint of this.rules.constraints) {
      if (!constraint.name) errors.push('约束规则缺少 name');
      if (!['warning', 'block', 'replan'].includes(constraint.consequence)) {
        errors.push(`约束规则 "${constraint.name || 'unknown'}" 的 consequence 无效`);
      }
    }
    return errors;
  }
}